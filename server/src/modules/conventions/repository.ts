import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L02 — conventions data-access. Owns the `conventions` table. Every query is
 * workspace-scoped (tenancy guard). A candidate is one extracted house rule
 * anchored to a `file:line` in the cloned repo.
 */

export type ConventionRow = typeof t.conventions.$inferSelect;

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  confidence: number;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    // Deterministic order (confidence desc, id asc) so the UI list doesn't
    // reshuffle after an accept/deselect refetch.
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.id));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Replace every candidate for a repo with a fresh set — re-scanning is
   * idempotent (a repo has exactly one current extraction). New rows start
   * unaccepted.
   */
  async replaceForRepo(
    workspaceId: string,
    repoId: string,
    rows: InsertConvention[],
  ): Promise<ConventionRow[]> {
    await this.db
      .delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(rows.map((r) => ({ ...r, accepted: false })))
      .returning();
  }

  async setAccepted(
    workspaceId: string,
    id: string,
    accepted: boolean,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ accepted })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Remove a single candidate from the list. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }

  /** Edit a candidate's rule text (the human-editable part of an insight). */
  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ rule })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
