import "dotenv/config";
import { createDb, type Db } from "./client.js";
import * as t from "./schema.js";
import { eq, and } from "drizzle-orm";

/**
 * Demo-only: backfills a few historical eval-run batches for the seeded
 * "General Reviewer" eval cases so the Eval Dashboard (sparklines, trend
 * chart, recent-runs table, Compare) has something to show before you've
 * actually run anything live. NOT wired into `db:seed` — run manually,
 * once, before recording a demo. Does not call any LLM: metrics are
 * synthetic, tagged `{ demo: true }` in `actual_output` so this script can
 * detect its own prior runs and stay idempotent (skips if already seeded).
 *
 * Usage: `pnpm db:seed-demo` (after `pnpm db:seed` has run at least once).
 */

type BatchTarget = {
  daysAgo: number;
  /** Fraction of the 8 seeded cases that should pass in this batch. */
  passFraction: number;
  recallRange: [number, number];
  precisionRange: [number, number];
  citationRange: [number, number];
};

// Four historical batches trending upward — mirrors the mockup's v3→v7 climb,
// including a small precision dip on the most recent batch (a realistic
// "one new false positive slipped in" moment, matching the Compare-modal demo).
const BATCHES: BatchTarget[] = [
  { daysAgo: 10, passFraction: 0.5, recallRange: [0.55, 0.65], precisionRange: [0.9, 0.95], citationRange: [0.85, 0.9] },
  { daysAgo: 7, passFraction: 0.625, recallRange: [0.68, 0.76], precisionRange: [0.88, 0.93], citationRange: [0.88, 0.92] },
  { daysAgo: 4, passFraction: 0.75, recallRange: [0.78, 0.85], precisionRange: [0.9, 0.95], citationRange: [0.9, 0.94] },
  { daysAgo: 2, passFraction: 0.75, recallRange: [0.8, 0.88], precisionRange: [0.87, 0.91], citationRange: [0.93, 0.96] },
];

function rand([lo, hi]: [number, number]): number {
  return Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
}

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export async function seedDemoRuns(db: Db): Promise<{ inserted: number; skipped: boolean }> {
  const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, "default"));
  if (!ws) {
    console.error("No default workspace found — run `pnpm db:seed` first.");
    return { inserted: 0, skipped: true };
  }

  const [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, ws.id), eq(t.agents.name, "General Reviewer")));
  if (!agent) {
    console.error('No "General Reviewer" agent found — run `pnpm db:seed` first.');
    return { inserted: 0, skipped: true };
  }

  const cases = await db
    .select()
    .from(t.evalCases)
    .where(and(eq(t.evalCases.ownerKind, "agent"), eq(t.evalCases.ownerId, agent.id)));
  if (cases.length === 0) {
    console.error('No eval cases found for "General Reviewer" — run `pnpm db:seed` first.');
    return { inserted: 0, skipped: true };
  }

  // Idempotency: if this agent already has demo-tagged runs, don't duplicate.
  const existingRuns = await db
    .select({ actualOutput: t.evalRuns.actualOutput })
    .from(t.evalRuns)
    .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
    .where(eq(t.evalCases.ownerId, agent.id));
  const alreadySeeded = existingRuns.some(
    (r) => r.actualOutput && typeof r.actualOutput === "object" && (r.actualOutput as Record<string, unknown>).demo === true,
  );
  if (alreadySeeded) {
    console.log("Demo runs already seeded for General Reviewer — skipping (delete eval_runs rows to reset).");
    return { inserted: 0, skipped: true };
  }

  let inserted = 0;
  for (const batch of BATCHES) {
    const ranAt = daysAgoDate(batch.daysAgo);
    const passCount = Math.round(cases.length * batch.passFraction);
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]!;
      const expectedCount = Array.isArray(c.expectedOutput) ? c.expectedOutput.length : 0;
      const pass = i < passCount;
      // expected 0 findings -> agent producing nothing is a pass; keep produced
      // consistent with the pass/fail we assigned so the eval-case status line
      // and dashboard numbers read coherently if you drill into a case.
      const produced = expectedCount === 0 ? (pass ? [] : [{ note: "unexpected finding" }]) : pass ? [{ note: "matched" }] : [];
      await db.insert(t.evalRuns).values({
        caseId: c.id,
        ranAt,
        pass,
        recall: expectedCount === 0 ? 1 : rand(batch.recallRange),
        precision: rand(batch.precisionRange),
        citationAccuracy: rand(batch.citationRange),
        durationMs: 800 + Math.round(Math.random() * 1400),
        costUsd: Math.round((0.01 + Math.random() * 0.02) * 10000) / 10000,
        actualOutput: {
          demo: true,
          produced,
          prompt_snapshot: { system_prompt: agent.systemPrompt ?? "", model: agent.model ?? "gpt-4.1" },
        },
      });
      inserted++;
    }
  }

  console.log(`✓ inserted ${inserted} demo eval_runs rows across ${BATCHES.length} batches for "General Reviewer".`);
  return { inserted, skipped: false };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const handle = createDb(url);
  seedDemoRuns(handle.db)
    .then(async () => {
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await handle.close();
      process.exit(1);
    });
}
