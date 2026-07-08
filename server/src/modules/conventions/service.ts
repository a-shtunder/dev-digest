import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConventionCandidate, Provider } from '@devdigest/shared';
import { ConventionExtraction } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository, type RepoRow } from '../repos/repository.js';
import { ConventionsRepository, type InsertConvention } from './repository.js';
import { buildGithubBlobUrl, parseEvidencePath, toConventionDto } from './helpers.js';
import { NotFoundError, ValidationError, ExternalServiceError } from '../../platform/errors.js';

/**
 * L02 — Conventions Extractor. Scans a cloned repo and surfaces house code-style
 * conventions, each anchored to real `file:line` evidence.
 *
 * Sampling is pure code (configs + top-ranked source files via repo-intel); the
 * only model call is a single cheap structured extraction. Every returned
 * candidate's file+line is verified against the clone before persisting, so
 * hallucinated anchors never reach the UI.
 */

const SAMPLE_FILE_COUNT = 8;
const MAX_FILE_BYTES = 4_000; // per-file cap keeps the prompt cheap
const MAX_TOTAL_SAMPLE_CHARS = 32_000; // hard cap across all samples → fast model call
const EXTRACT_TIMEOUT_MS = 60_000; // fail cleanly instead of hanging forever
const EXTRACT_MAX_TOKENS = 1_200; // bound output → less generation latency
const MAX_CANDIDATES = 10; // ask the model for the strongest N only

/** Well-known config files (excluded by getConventionSamples, so read by name). */
const CONFIG_FILES = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.cjs',
  'package.json',
];

interface SampledFile {
  path: string;
  content: string;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  /** Persisted candidates for a repo, with GitHub deep-links. */
  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map((r) => toConventionDto(r, this.evidenceUrl(repo, r.evidencePath)));
  }

  /** Accept/reject a single candidate. */
  async setAccepted(
    workspaceId: string,
    id: string,
    accepted: boolean,
  ): Promise<ConventionCandidate> {
    const row = await this.repo.setAccepted(workspaceId, id, accepted);
    if (!row) throw new NotFoundError('Convention not found');
    const repo = row.repoId ? await this.repos.getById(workspaceId, row.repoId) : undefined;
    return toConventionDto(row, repo ? this.evidenceUrl(repo, row.evidencePath) : undefined);
  }

  /** Remove a single candidate. Returns false when it doesn't exist here. */
  async remove(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Edit a single candidate's rule text. */
  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionCandidate> {
    const row = await this.repo.updateRule(workspaceId, id, rule);
    if (!row) throw new NotFoundError('Convention not found');
    const repo = row.repoId ? await this.repos.getById(workspaceId, row.repoId) : undefined;
    return toConventionDto(row, repo ? this.evidenceUrl(repo, row.evidencePath) : undefined);
  }

  /** Run a fresh extraction: sample → cheap model → verify evidence → persist. */
  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (!repo.clonePath) {
      throw new ValidationError('Repo is not cloned yet — wait for the clone to finish, then re-scan.');
    }

    // 1) Sampling — pure code, no model.
    const samples = await this.collectSamples(repo.clonePath, repoId);
    if (samples.length === 0) {
      throw new ValidationError('No sample files found to analyze.');
    }

    // 2) One cheap structured model call (feature-model: conventions).
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    let extraction: ConventionExtraction;
    try {
      const llm = await this.container.llm(provider as Provider);
      const res = await llm.completeStructured({
        model,
        schema: ConventionExtraction,
        schemaName: 'ConventionExtraction',
        messages: buildMessages(repo.fullName, samples, MAX_CANDIDATES),
        timeoutMs: EXTRACT_TIMEOUT_MS,
        maxTokens: EXTRACT_MAX_TOKENS,
        // Keep it snappy: one schema-repair at most, no long reprompt loop.
        maxRetries: 1,
      });
      extraction = res.data;
    } catch (err) {
      throw new ExternalServiceError(`Convention extraction failed: ${(err as Error).message}`);
    }

    // 3) Evidence verification — the file and cited line must exist in the
    //    clone. Candidates whose anchor can't be resolved are dropped.
    const verified: InsertConvention[] = [];
    const seen = new Set<string>();
    for (const c of extraction.candidates) {
      const file = c.evidence.file.replace(/^\.?\//, '');
      const snippet = await this.snippetAt(repo.clonePath, file, c.evidence.line);
      if (!snippet) continue;
      const key = `${c.rule}::${file}:${c.evidence.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      verified.push({
        workspaceId,
        repoId,
        rule: c.rule,
        evidencePath: `${file}:${c.evidence.line}`,
        evidenceSnippet: snippet,
        confidence: c.confidence,
      });
    }

    // Keep the strongest N even if the model over-produced.
    verified.sort((a, b) => b.confidence - a.confidence);
    await this.repo.replaceForRepo(workspaceId, repoId, verified.slice(0, MAX_CANDIDATES));
    // Read back through the ordered list so extract + list agree on order.
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map((r) => toConventionDto(r, this.evidenceUrl(repo, r.evidencePath)));
  }

  // ---- private -------------------------------------------------------------

  private evidenceUrl(repo: RepoRow, evidencePath: string | null): string | null {
    if (!evidencePath) return null;
    const { path, line } = parseEvidencePath(evidencePath);
    return buildGithubBlobUrl(repo.owner, repo.name, repo.defaultBranch, path, line);
  }

  private async collectSamples(clonePath: string, repoId: string): Promise<SampledFile[]> {
    const top = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    const paths = [...CONFIG_FILES, ...top];

    const out: SampledFile[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (const p of paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      const content = await readFile(join(clonePath, p), 'utf8').catch(() => null);
      if (content == null) continue;
      const slice = content.slice(0, MAX_FILE_BYTES);
      if (total + slice.length > MAX_TOTAL_SAMPLE_CHARS) break; // keep the prompt bounded
      out.push({ path: p, content: slice });
      total += slice.length;
    }
    return out;
  }

  /** The cited line plus a couple of trailing lines, or null when unresolvable. */
  private async snippetAt(
    clonePath: string,
    file: string,
    line: number,
  ): Promise<string | null> {
    const content = await readFile(join(clonePath, file), 'utf8').catch(() => null);
    if (content == null) return null;
    const lines = content.split('\n');
    if (line < 1 || line > lines.length) return null;
    const start = line - 1;
    const end = Math.min(lines.length, line + 2);
    const snippet = lines.slice(start, end).join('\n').trim();
    return snippet || null;
  }
}

/** Assemble the extraction prompt. Files are line-numbered so the model cites real lines. */
function buildMessages(fullName: string, samples: SampledFile[], maxCandidates: number) {
  const body = samples
    .map((s) => {
      const numbered = s.content
        .split('\n')
        .map((l, i) => `${i + 1}\t${l}`)
        .join('\n');
      return `// FILE: ${s.path}\n${numbered}`;
    })
    .join('\n\n');

  return [
    {
      role: 'system' as const,
      content:
        'You extract house coding conventions from sampled repository files. ' +
        `Return at most ${maxCandidates} of the STRONGEST rules — quality over ` +
        'quantity. Return only rules you can anchor to a concrete file and 1-based ' +
        'line number that appears in the samples. Prefer rules about naming, error ' +
        'handling, async style, module boundaries, and API/response shapes. ' +
        'Never invent files or lines. Each rule must be short and directive ' +
        '(e.g. "Always use async/await instead of .then() chains").',
    },
    {
      role: 'user' as const,
      content:
        `Repository: ${fullName}\n\n` +
        `Sampled files (the number before each tab is that file's 1-based line):\n\n` +
        `${body}\n\n` +
        'Extract the house conventions as structured candidates with evidence.',
    },
  ];
}
