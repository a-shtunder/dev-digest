/**
 * AgentsRepository.setAttachedDocs — targeted update that must:
 *   - persist the ordered `attached_doc_paths` array exactly as given (no
 *     sort/dedupe — order IS attach order)
 *   - NEVER bump `version` (docs are not part of agent config versioning)
 *   - allow a later call with a reordered array to persist the new order
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentsRepository } from './repository.js';
import type { Db } from '../../db/client.js';
import type { AgentRow } from './repository.js';

/** Minimal agent row fixture, version pinned so we can assert it stays put. */
function agentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    description: 'desc',
    provider: 'openrouter',
    model: 'deepseek/v3',
    systemPrompt: 'You are a reviewer.',
    outputSchema: null,
    enabled: true,
    version: 3,
    strategy: 'single_pass',
    ciFailOn: 'critical',
    repoIntel: false,
    attachedDocPaths: [],
    createdBy: null,
    ...overrides,
  } as AgentRow;
}

/** A mock `db.update(...).set(...).where(...).returning()` chain that records
 *  the `.set()` payload and resolves with a row reflecting it. */
function makeDb(existing: AgentRow) {
  const setCalls: unknown[] = [];
  const db = {
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((patch: Partial<AgentRow>) => {
        setCalls.push(patch);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...existing, ...patch }]),
          }),
        };
      }),
    })),
  } as unknown as Db;
  return { db, setCalls };
}

describe('AgentsRepository.setAttachedDocs', () => {
  it('persists the ordered array and never bumps version', async () => {
    const existing = agentRow({ version: 3, attachedDocPaths: [] });
    const { db, setCalls } = makeDb(existing);
    const repo = new AgentsRepository(db);

    const row = await repo.setAttachedDocs('ws-1', 'agent-1', ['a.md', 'b.md']);

    expect(row?.attachedDocPaths).toEqual(['a.md', 'b.md']);
    expect(row?.version).toBe(3); // unchanged
    // The update payload must touch only attachedDocPaths — no `version` key.
    expect(setCalls).toEqual([{ attachedDocPaths: ['a.md', 'b.md'] }]);
  });

  it('reordering persists the new order (no sort/dedupe)', async () => {
    const existing = agentRow({ version: 5, attachedDocPaths: ['a.md', 'b.md'] });
    const { db } = makeDb(existing);
    const repo = new AgentsRepository(db);

    const row = await repo.setAttachedDocs('ws-1', 'agent-1', ['b.md', 'a.md']);

    expect(row?.attachedDocPaths).toEqual(['b.md', 'a.md']);
    expect(row?.version).toBe(5); // still unchanged
  });
});
