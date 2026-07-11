import { describe, it, expect } from 'vitest';
import type { LLMProvider, Review, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });

  describe('fileSummaries (A2/A5 — extracted from partials[] before reduce)', () => {
    // Two-file diff, large enough (>400 lines total via padded hunk context isn't
    // needed — we force map-reduce explicitly via strategy) so map-reduce runs
    // one LLM call per file: src/config.ts and src/util.ts.
    const multiFileDiff =
      'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,\n' +
      'diff --git a/src/util.ts b/src/util.ts\n--- a/src/util.ts\n+++ b/src/util.ts\n@@ -1,2 +1,3 @@\n export function add(a, b) {\n+  return a + b;\n }\n';

    /** Per-file walkthroughs, keyed by file path — used to drive a per-call stub LLM. */
    function makePerFileLLM(walkthroughsByFile: Record<string, string | undefined>): LLMProvider {
      return {
        id: 'openai',
        async completeStructured<T>(req): Promise<StructuredResult<T>> {
          // The diff chunk for a map-reduce call is scoped to a single file, so
          // the file path always appears in the assembled user message.
          const userText = req.messages.map((m) => m.content).join('\n');
          const path = Object.keys(walkthroughsByFile).find((p) => userText.includes(p));
          const walkthrough = path ? walkthroughsByFile[path] : undefined;
          const data: Review = {
            verdict: 'approve',
            summary: 'looks fine',
            score: 95,
            findings: [],
            ...(walkthrough !== undefined ? { walkthrough } : {}),
          };
          return {
            data: data as unknown as T,
            model: req.model,
            tokensIn: 10,
            tokensOut: 5,
            costUsd: 0,
            raw: JSON.stringify(data),
            attempts: 1,
          };
        },
        async listModels() {
          return [];
        },
        async complete() {
          throw new Error('not used');
        },
        async embed() {
          return [];
        },
      };
    }

    it('map-reduce: one fileSummaries entry per file, path === file path', async () => {
      const llm = makePerFileLLM({
        'src/config.ts': 'Adds a hardcoded Stripe key to the config object.',
        'src/util.ts': 'Adds an add() helper function.',
      });
      const diff = await new MockGitClient({ diff: multiFileDiff }).diff();

      const outcome = await reviewPullRequest({
        systemPrompt: 'reviewer',
        model: 'gpt-4.1',
        diff,
        llm,
        strategy: 'map-reduce',
      });

      expect(outcome.mode).toBe('map-reduce');
      expect(outcome.fileSummaries).toHaveLength(2);
      expect(outcome.fileSummaries).toEqual(
        expect.arrayContaining([
          { path: 'src/config.ts', summary: 'Adds a hardcoded Stripe key to the config object.' },
          { path: 'src/util.ts', summary: 'Adds an add() helper function.' },
        ]),
      );
    });

    it('single-pass: fileSummaries is empty (no per-file attribution)', async () => {
      const llm = new MockLLMProvider('openai', {
        structured: {
          verdict: 'approve',
          summary: 'ok',
          score: 90,
          findings: [],
          walkthrough: 'Should be ignored — single-pass has no per-file attribution.',
        },
      });
      const diff = await new MockGitClient().diff();

      const outcome = await reviewPullRequest({
        systemPrompt: 'reviewer',
        model: 'gpt-4.1',
        diff,
        llm,
        strategy: 'single-pass',
      });

      expect(outcome.mode).toBe('single-pass');
      expect(outcome.fileSummaries).toEqual([]);
    });

    it('map-reduce: a partial with an absent/empty walkthrough is skipped', async () => {
      const llm = makePerFileLLM({
        'src/config.ts': 'Adds a hardcoded Stripe key to the config object.',
        'src/util.ts': '', // empty → must be skipped
      });
      const diff = await new MockGitClient({ diff: multiFileDiff }).diff();

      const outcome = await reviewPullRequest({
        systemPrompt: 'reviewer',
        model: 'gpt-4.1',
        diff,
        llm,
        strategy: 'map-reduce',
      });

      expect(outcome.mode).toBe('map-reduce');
      expect(outcome.fileSummaries).toEqual([
        { path: 'src/config.ts', summary: 'Adds a hardcoded Stripe key to the config object.' },
      ]);
    });
  });
});
