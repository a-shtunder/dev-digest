import { describe, it, expect, vi } from 'vitest';
import type { Intent, SmartDiff, SmartDiffFile } from '@devdigest/shared';
import { classifyBrief, classifyCoreFileSummaries } from './classifier.js';
import type { Container } from '../../platform/container.js';

/** Minimal fake `container.db` chain satisfying `resolveFeatureModel`'s query (no override). */
function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };
}

function fakeContainer(completeStructured: ReturnType<typeof vi.fn>): Container {
  return {
    db: fakeDb(),
    llm: async () => ({
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('not used');
      },
      completeStructured,
      embed: async () => [],
    }),
  } as unknown as Container;
}

const intent: Intent = {
  intent: 'Add rate limiting to the login endpoint',
  in_scope: ['server/src/modules/auth'],
  out_of_scope: ['client/'],
};

const smartDiff: SmartDiff = {
  groups: [
    {
      role: 'core',
      files: [
        {
          path: 'server/src/modules/auth/service.ts',
          pseudocode_summary: 'SECRET_PSEUDOCODE_BODY_SHOULD_NOT_LEAK',
          additions: 12,
          deletions: 3,
          finding_lines: [10, 11],
        },
      ],
    },
    {
      role: 'boilerplate',
      files: [
        {
          path: 'server/src/modules/auth/index.ts',
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 16, proposed_splits: [] },
};

describe('classifyBrief', () => {
  it('assembles a stats/summaries-only prompt and issues exactly one structured call', async () => {
    const completeStructured = vi.fn().mockResolvedValue({
      data: {
        what: 'Adds rate limiting',
        why: 'Prevent brute force',
        risk_level: 'medium',
        risks: [],
        review_focus: [],
      },
      model: 'gpt-4.1',
      tokensIn: 1,
      tokensOut: 1,
      costUsd: null,
      raw: '{}',
      attempts: 1,
    });
    const container = fakeContainer(completeStructured);

    const result = await classifyBrief({
      prTitle: 'Add login rate limiting',
      prBody: 'This PR adds rate limiting.',
      intent,
      blastSummary: 'Touches 2 files in the auth module; no downstream callers.',
      smartDiff,
      issue: { title: 'Brute force risk', body: 'Users can brute force login.' },
      references: [{ kind: 'repo-file', source: 'specs/auth.md', content: 'Auth spec content.' }],
      container,
      workspaceId: 'ws-1',
    });

    expect(result.brief.what).toBe('Adds rate limiting');
    expect(completeStructured).toHaveBeenCalledTimes(1);

    const call = completeStructured.mock.calls[0]![0];
    const prompt = call.messages.map((m: { content: string }) => m.content).join('\n');

    // Contains stats/summaries.
    expect(prompt).toContain('Add login rate limiting');
    expect(prompt).toContain(intent.intent);
    expect(prompt).toContain('Touches 2 files in the auth module');
    expect(prompt).toContain('server/src/modules/auth/service.ts');
    expect(prompt).toContain('+12/-3');
    expect(prompt).toContain('Brute force risk');
    expect(prompt).toContain('Auth spec content.');

    // Never contains file/diff body content.
    expect(prompt).not.toContain('SECRET_PSEUDOCODE_BODY_SHOULD_NOT_LEAK');
    expect(prompt).not.toContain('@@'); // no unified-diff hunk headers

    // Untrusted fragments are wrapped.
    expect(prompt).toContain('pr-body');
    expect(prompt).toContain('linked-issue');
    expect(prompt).toContain('spec:specs/auth.md');
  });
});

describe('classifyCoreFileSummaries', () => {
  it('builds a batched per-file prompt from core-file stats only and issues exactly one call', async () => {
    const completeStructured = vi.fn().mockResolvedValue({
      data: { files: [{ path: 'server/src/modules/auth/service.ts', summary: 'Adds a rate limiter middleware.' }] },
      model: 'gpt-4.1',
      tokensIn: 1,
      tokensOut: 1,
      costUsd: null,
      raw: '{}',
      attempts: 1,
    });
    const container = fakeContainer(completeStructured);

    const coreFiles: SmartDiffFile[] = smartDiff.groups[0]!.files;

    const result = await classifyCoreFileSummaries({
      coreFiles,
      container,
      workspaceId: 'ws-1',
    });

    expect(result.summaries).toEqual({
      'server/src/modules/auth/service.ts': 'Adds a rate limiter middleware.',
    });
    expect(completeStructured).toHaveBeenCalledTimes(1);

    const call = completeStructured.mock.calls[0]![0];
    const prompt = call.messages.map((m: { content: string }) => m.content).join('\n');

    expect(prompt).toContain('server/src/modules/auth/service.ts');
    expect(prompt).toContain('role=core');
    expect(prompt).toContain('+12/-3');

    // Never contains file/diff body content.
    expect(prompt).not.toContain('SECRET_PSEUDOCODE_BODY_SHOULD_NOT_LEAK');
    expect(prompt).not.toContain('@@');
  });

  it('skips the LLM call entirely when there are no core files', async () => {
    const completeStructured = vi.fn();
    const container = fakeContainer(completeStructured);

    const result = await classifyCoreFileSummaries({ coreFiles: [], container, workspaceId: 'ws-1' });

    expect(result.summaries).toEqual({});
    expect(completeStructured).not.toHaveBeenCalled();
  });
});
