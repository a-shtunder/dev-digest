import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import {
  ExpectedFinding,
  type EvalCase,
  type EvalCaseInput,
  type EvalRunRecord,
  type EvalTrendPoint,
} from '@devdigest/shared';

/**
 * T3 — Eval data-access. Drizzle over `eval_cases` / `eval_runs`
 * (`server/src/db/schema/eval.ts`). Every query is workspace-scoped, either
 * directly on `eval_cases.workspace_id` or via an inner join through it for
 * `eval_runs` (which has no `workspace_id` column of its own).
 *
 * `$inferSelect`/`$inferInsert` never leave this file — callers only see the
 * shared DTOs (`EvalCase`, `EvalRunRecord`, `EvalTrendPoint`).
 */

// ---- Row types (kept local per the onion-architecture infra rule) ---------

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;
type EvalCaseInsert = typeof t.evalCases.$inferInsert;
type EvalRunInsert = typeof t.evalRuns.$inferInsert;

// ---- Config snapshot (rides the existing `actual_output` jsonb column) ----

/** The prompt/model config in effect when a run executed — powers the
 *  Compare prompt-diff. No migration: persisted inside `eval_runs.actual_output`. */
export interface PromptSnapshot {
  system_prompt: string;
  model: string;
}

const PromptSnapshotSchema = z.object({
  system_prompt: z.string(),
  model: z.string(),
});

/** Shape written into `eval_runs.actual_output`. `.catchall(z.unknown())`
 *  tolerates arbitrary extra run detail (produced findings, per-trace notes,
 *  etc.) while still typing the one field we rely on for Compare. */
const ActualOutputSchema = z
  .object({
    prompt_snapshot: PromptSnapshotSchema.nullish(),
  })
  .catchall(z.unknown());

/** jsonb is untyped at the DB layer — never trust it without a parse. */
const expectedOutputSchema = z.array(ExpectedFinding).catch([]);

export interface InsertEvalRunParams {
  caseId: string;
  /**
   * Explicit batch timestamp so every case scored by one `runSet` call shares
   * the same `ran_at` — that shared timestamp is what lets the dashboard
   * reads below group per-case rows back into one trend point / batch.
   * Omit for a single-case run to fall back to the column's `defaultNow()`.
   */
  ranAt?: Date;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  /** Arbitrary run detail (e.g. produced findings) merged into `actual_output`. */
  actualOutput?: Record<string, unknown> | null;
  promptSnapshot?: PromptSnapshot | null;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- Cases ----------------------------------------------------------

  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    const values: EvalCaseInsert = {
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    };
    const [row] = await this.db.insert(t.evalCases).values(values).returning();
    return this.toCaseDomain(row!);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row ? this.toCaseDomain(row) : undefined;
  }

  /** Updates an existing `eval_cases` row in place, workspace-scoped. Returns
   *  `undefined` if no row matches (wrong id or wrong workspace — same IDOR
   *  discipline as `getCase`), letting the service turn that into a
   *  `NotFoundError` rather than silently updating another workspace's row. */
  async updateCase(
    workspaceId: string,
    caseId: string,
    input: EvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const values: Partial<EvalCaseInsert> = {
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    };
    const [row] = await this.db
      .update(t.evalCases)
      .set(values)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row ? this.toCaseDomain(row) : undefined;
  }

  /** Deletes an `eval_cases` row, workspace-scoped (same IDOR discipline as
   *  `getCase`/`updateCase`). Its `eval_runs` history cascade-deletes via the
   *  FK (`onDelete: 'cascade'` in `schema/eval.ts`). Returns `true` if a row
   *  was actually deleted, `false` if no matching row existed in this
   *  workspace — the service turns that into a `NotFoundError`. */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const [row] = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return !!row;
  }

  /** `owner_kind='agent'` cases owned by `agentId`, scoped to `workspaceId`. */
  async listCasesForAgent(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      );
    return rows.map((r) => this.toCaseDomain(r));
  }

  // ---- Runs -------------------------------------------------------------

  async insertRun(params: InsertEvalRunParams): Promise<EvalRunRecord> {
    const actualOutput = {
      ...(params.actualOutput ?? {}),
      prompt_snapshot: params.promptSnapshot ?? null,
    };
    const values: EvalRunInsert = {
      caseId: params.caseId,
      ...(params.ranAt !== undefined ? { ranAt: params.ranAt } : {}),
      pass: params.pass,
      recall: params.recall,
      precision: params.precision,
      citationAccuracy: params.citationAccuracy,
      durationMs: params.durationMs,
      costUsd: params.costUsd,
      actualOutput,
    };
    const [row] = await this.db.insert(t.evalRuns).values(values).returning();
    return this.toRunDomain(row!);
  }

  /** Full run history for one case, chronological (oldest first), scoped to
   *  the workspace via the owning case. */
  async listRunsForCase(workspaceId: string, caseId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name, agentId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalRuns.caseId, caseId)))
      .orderBy(asc(t.evalRuns.ranAt));
    return rows.map((r) => this.toRunDomain(r.run, r.caseName, r.agentId));
  }

  // ---- Dashboard reads ----------------------------------------------

  /** The most recent batch of runs (every case scored together in one
   *  `runSet` call shares `ran_at`) for this agent. */
  async latestRunsForAgent(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const [latest] = await this.batchTimestampsForAgent(workspaceId, agentId, 1);
    return latest ? this.runsAtTimestamp(workspaceId, agentId, latest) : [];
  }

  /** The batch immediately before the latest one — used for the dashboard's
   *  current-vs-previous delta. */
  async previousRunsForAgent(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const [, previous] = await this.batchTimestampsForAgent(workspaceId, agentId, 2);
    return previous ? this.runsAtTimestamp(workspaceId, agentId, previous) : [];
  }

  /** One point per batch (most recent `limit` batches), chronological. Metrics
   *  are averaged across the batch's cases — an approximation of the true
   *  micro-average (which needs raw match counts, computed once at run time
   *  in `scoring.ts` and not persisted); acceptable for a historical trend. */
  async trendForAgent(
    workspaceId: string,
    agentId: string,
    limit = 20,
  ): Promise<EvalTrendPoint[]> {
    const caseIds = await this.caseIdsForAgent(workspaceId, agentId);
    if (caseIds.length === 0) return [];
    const rows = await this.db
      .select({
        ranAt: t.evalRuns.ranAt,
        recall: sql<number | string | null>`avg(${t.evalRuns.recall})`,
        precision: sql<number | string | null>`avg(${t.evalRuns.precision})`,
        citationAccuracy: sql<number | string | null>`avg(${t.evalRuns.citationAccuracy})`,
        passRate: sql<number | string | null>`avg(case when ${t.evalRuns.pass} then 1.0 else 0.0 end)`,
        costUsd: sql<number | string | null>`sum(${t.evalRuns.costUsd})`,
      })
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .groupBy(t.evalRuns.ranAt)
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows
      .map((r) => this.toTrendPoint(r))
      .sort((a, b) => a.ran_at.localeCompare(b.ran_at));
  }

  /** Flat list of the most recent run rows for one agent's cases (used for
   *  the agent dashboard's `recent_runs`). */
  async recentRunsForAgent(
    workspaceId: string,
    agentId: string,
    limit = 20,
  ): Promise<EvalRunRecord[]> {
    const caseIds = await this.caseIdsForAgent(workspaceId, agentId);
    if (caseIds.length === 0) return [];
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name, agentId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map((r) => this.toRunDomain(r.run, r.caseName, r.agentId));
  }

  /** Flat list of the most recent run rows across every agent-owned case in
   *  the workspace (used by the workspace-wide eval overview). */
  async recentRunsForWorkspace(workspaceId: string, limit = 20): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name, agentId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map((r) => this.toRunDomain(r.run, r.caseName, r.agentId));
  }

  // ---- Private helpers ------------------------------------------------

  private async caseIdsForAgent(workspaceId: string, agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      );
    return rows.map((r) => r.id);
  }

  /** Distinct `ran_at` batch timestamps for this agent, most-recent first. */
  private async batchTimestampsForAgent(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<Date[]> {
    const caseIds = await this.caseIdsForAgent(workspaceId, agentId);
    if (caseIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ ranAt: t.evalRuns.ranAt })
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map((r) => r.ranAt);
  }

  /** All run rows sharing one batch timestamp, for this agent's cases. */
  private async runsAtTimestamp(
    workspaceId: string,
    agentId: string,
    ranAt: Date,
  ): Promise<EvalRunRecord[]> {
    const caseIds = await this.caseIdsForAgent(workspaceId, agentId);
    if (caseIds.length === 0) return [];
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name, agentId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(inArray(t.evalRuns.caseId, caseIds), eq(t.evalRuns.ranAt, ranAt)))
      .orderBy(asc(t.evalCases.name));
    return rows.map((r) => this.toRunDomain(r.run, r.caseName, r.agentId));
  }

  // ---- Mappers (Drizzle rows never leave this file) --------------------

  private toCaseDomain(row: EvalCaseRow): EvalCase {
    return {
      id: row.id,
      owner_kind: row.ownerKind,
      owner_id: row.ownerId,
      name: row.name,
      input_diff: row.inputDiff ?? '',
      input_files: row.inputFiles,
      input_meta: row.inputMeta,
      expected_output: expectedOutputSchema.parse(row.expectedOutput ?? []),
      notes: row.notes,
    };
  }

  private toRunDomain(
    row: EvalRunRow,
    caseName?: string | null,
    agentId?: string | null,
  ): EvalRunRecord {
    return {
      id: row.id,
      case_id: row.caseId,
      case_name: caseName ?? null,
      agent_id: agentId ?? null,
      ran_at: row.ranAt.toISOString(),
      actual_output: this.parseActualOutput(row.actualOutput),
      pass: row.pass,
      recall: row.recall,
      precision: row.precision,
      citation_accuracy: row.citationAccuracy,
      duration_ms: row.durationMs,
      cost_usd: row.costUsd,
    };
  }

  private toTrendPoint(row: {
    ranAt: Date;
    recall: number | string | null;
    precision: number | string | null;
    citationAccuracy: number | string | null;
    passRate: number | string | null;
    costUsd: number | string | null;
  }): EvalTrendPoint {
    return {
      ran_at: row.ranAt.toISOString(),
      recall: Number(row.recall ?? 0),
      precision: Number(row.precision ?? 0),
      citation_accuracy: Number(row.citationAccuracy ?? 0),
      pass_rate: Number(row.passRate ?? 0),
      cost_usd: row.costUsd === null ? null : Number(row.costUsd),
    };
  }

  /** Validate the untrusted jsonb blob before handing it back as `unknown`
   *  (`EvalRunRecord.actual_output` is `z.unknown()` — this only guards the
   *  `prompt_snapshot` field callers rely on for Compare). */
  private parseActualOutput(raw: unknown): unknown {
    const parsed = ActualOutputSchema.safeParse(raw);
    return parsed.success ? parsed.data : (raw ?? null);
  }
}
