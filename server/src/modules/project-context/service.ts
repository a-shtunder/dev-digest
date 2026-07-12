/**
 * service.ts — ProjectContextService: application-layer orchestration for the
 * Project Context feature (discovery + summary + guarded document read/save).
 *
 * Onion layer: application. No raw SQL and no adapter instantiation live
 * here — repo lookup goes through `container.reviewRepo`-style shared
 * repositories already exposed on the container (`container.agentsRepo` for
 * the `used_by_agents` enrichment), filesystem I/O is delegated to
 * `discovery.ts` / `documents.ts` (infrastructure), and the clone root is
 * resolved via `container.git.clonePathFor` (already absolute).
 */
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { DiscoveredDocument, DiscoverySummary, DocumentContent } from '@devdigest/shared';
import { discover } from './discovery.js';
import { readDocument, writeDocument } from './documents.js';
import { RepoRepository } from '../repos/repository.js';

/** Node's fs errno code for "file not found" — used to map a missing-file
 *  read error to a clean 404 instead of falling through to a generic 500. */
const ENOENT = 'ENOENT';

export class ProjectContextService {
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repos = new RepoRepository(container.db);
  }

  /**
   * Resolve the repo row (tenancy-scoped), derive the clone root (null when
   * the repo has never been cloned), discover eligible documents, then
   * enrich each with `used_by_agents` — the count of agents in the workspace
   * whose `attached_doc_paths` include that document's path. Read directly
   * off the agent repository rows (not `toAgentDto`) since the DTO mapper
   * does not yet surface `attached_doc_paths` (wired in a later task).
   */
  async listForRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<{ documents: DiscoveredDocument[]; summary: DiscoverySummary }> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const cloneRoot = repo.clonePath
      ? this.container.git.clonePathFor({ owner: repo.owner, name: repo.name })
      : null;

    const { documents, summary } = await discover(cloneRoot, this.container.tokenizer);

    const agentRows = await this.container.agentsRepo.list(workspaceId);
    const usageByPath = new Map<string, number>();
    for (const agent of agentRows) {
      for (const path of agent.attachedDocPaths) {
        usageByPath.set(path, (usageByPath.get(path) ?? 0) + 1);
      }
    }

    const enriched = documents.map((doc) => ({
      ...doc,
      used_by_agents: usageByPath.get(doc.path) ?? 0,
    }));

    return { documents: enriched, summary };
  }

  /** Guarded read of a discovered document's raw text (Preview/Edit source). */
  async readDocument(workspaceId: string, repoId: string, path: string): Promise<DocumentContent> {
    const repo = await this.getRepoOrThrow(workspaceId, repoId);
    try {
      const text = await readDocument(this.container.git, { owner: repo.owner, name: repo.name }, path);
      return { path, text };
    } catch (err) {
      if (isEnoent(err)) throw new NotFoundError('Document not found', { path });
      throw err;
    }
  }

  /** Guarded write of a document's text into the clone working tree (Edit save). */
  async saveDocument(
    workspaceId: string,
    repoId: string,
    path: string,
    text: string,
  ): Promise<DocumentContent> {
    const repo = await this.getRepoOrThrow(workspaceId, repoId);
    await writeDocument(this.container.git, { owner: repo.owner, name: repo.name }, path, text);
    return { path, text };
  }

  private async getRepoOrThrow(workspaceId: string, repoId: string) {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === ENOENT;
}
