import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// One valid candidate + two that must be dropped (missing file, out-of-range line).
const EXTRACTION = {
  candidates: [
    {
      category: 'structure',
      rule: 'Redis access goes through the src/lib/redis.ts singleton',
      evidence: { file: 'src/lib/redis.ts', line: 1 },
      confidence: 0.85,
    },
    {
      category: 'naming',
      rule: 'Hallucinated rule citing a file that does not exist',
      evidence: { file: 'src/ghost.ts', line: 5 },
      confidence: 0.8,
    },
    {
      category: 'async',
      rule: 'Hallucinated rule citing a line past EOF',
      evidence: { file: 'src/lib/redis.ts', line: 999 },
      confidence: 0.7,
    },
  ],
};

d('Conventions Extractor (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // A tiny fake clone: a config file (so sampling has something) + the file the
    // valid candidate cites.
    clonePath = await mkdtemp(join(tmpdir(), 'conv-clone-'));
    await writeFile(join(clonePath, 'package.json'), '{ "name": "payments-api" }\n');
    await mkdir(join(clonePath, 'src', 'lib'), { recursive: true });
    await writeFile(
      join(clonePath, 'src', 'lib', 'redis.ts'),
      'export const redis = new Redis(config.redisUrl);\n',
    );
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: new MockLLMProvider('openai', { structured }) } },
    });
  }

  let seq = 0;
  async function insertRepo() {
    const name = `payments-api-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath,
      })
      .returning();
    return repo!;
  }

  it('extract keeps only candidates whose file+line resolve in the clone', async () => {
    const app = await appWith(EXTRACTION);
    const repo = await insertRepo();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/extract`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Two hallucinated candidates dropped; only the verified one survives.
    expect(body).toHaveLength(1);
    expect(body[0].rule).toContain('src/lib/redis.ts singleton');
    expect(body[0].evidence_path).toBe('src/lib/redis.ts:1');
    expect(body[0].evidence_snippet).toContain('new Redis');
    expect(body[0].accepted).toBe(false);
    expect(body[0].evidence_url).toBe(
      `https://github.com/acme/${repo.name}/blob/main/src/lib/redis.ts#L1`,
    );
  });

  it('accept then reject toggles the candidate', async () => {
    const app = await appWith(EXTRACTION);
    const repo = await insertRepo();
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });

    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json();
    const id = list[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/conventions/${id}/accept` })
    ).json();
    expect(accepted.accepted).toBe(true);

    const rejected = (
      await app.inject({ method: 'POST', url: `/conventions/${id}/reject` })
    ).json();
    expect(rejected.accepted).toBe(false);
  });

  it('PATCH edits a candidate rule and it persists', async () => {
    const app = await appWith(EXTRACTION);
    const repo = await insertRepo();
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const id = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json()[0]
      .id;

    const edited = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${id}`,
        payload: { rule: 'Edited: Redis access goes through the singleton' },
      })
    ).json();
    expect(edited.rule).toBe('Edited: Redis access goes through the singleton');

    // Persisted — a fresh list reflects the edit.
    const reloaded = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })
    ).json();
    expect(reloaded[0].rule).toBe('Edited: Redis access goes through the singleton');
  });

  it('DELETE removes a candidate from the list', async () => {
    const app = await appWith(EXTRACTION);
    const repo = await insertRepo();
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const id = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json()[0]
      .id;

    const del = await app.inject({ method: 'DELETE', url: `/conventions/${id}` });
    expect(del.statusCode).toBe(200);

    const after = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })
    ).json();
    expect(after).toHaveLength(0);
  });

  it('extract 400s when the repo has no clone yet', async () => {
    const app = await appWith(EXTRACTION);
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'uncloned', fullName: 'acme/uncloned' })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo!.id}/conventions/extract`,
    });
    expect(res.statusCode).toBe(422);
  });
});
