import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { PrBriefResponse } from '@devdigest/shared';

/**
 * T5 — brief cache data-access. The ONLY place that touches the `pr_brief`
 * table. Stores/returns the full `PrBriefResponse` JSON keyed by `prId`,
 * alongside the `head_sha` it was generated for. A cache hit/miss decision
 * (comparing stored `headSha` to the PR's current head SHA) is the service's
 * job — this repository just stores and returns what it's given.
 */

type PrBriefRow = typeof t.prBrief.$inferSelect;

export interface PrBriefCacheEntry {
  json: PrBriefResponse;
  headSha: string | null;
}

function toDomain(row: PrBriefRow): PrBriefCacheEntry {
  // JSON column is untyped at the DB layer — parse/validate before trusting it.
  return {
    json: PrBriefResponse.parse(row.json),
    headSha: row.headSha,
  };
}

function toDb(headSha: string, response: PrBriefResponse) {
  return {
    json: response,
    headSha,
  };
}

export class BriefRepository {
  constructor(private db: Db) {}

  async get(prId: string): Promise<PrBriefCacheEntry | null> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row ? toDomain(row) : null;
  }

  async upsert(prId: string, headSha: string, response: PrBriefResponse): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, ...toDb(headSha, response) })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: toDb(headSha, response),
      });
  }
}
