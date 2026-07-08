import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import {
  slugify,
  repoShortName,
  buildSkillName,
  buildSkillDescription,
  buildSkillBody,
} from "./helpers";

function cand(over: Partial<ConventionCandidate> & { rule: string }): ConventionCandidate {
  return {
    id: over.id ?? "c1",
    rule: over.rule,
    evidence_path: over.evidence_path ?? "src/api/users.ts:23-31",
    evidence_snippet: over.evidence_snippet ?? "const u = await db.find(id);",
    confidence: over.confidence ?? 0.9,
    accepted: over.accepted ?? true,
    ...(over.evidence_url !== undefined ? { evidence_url: over.evidence_url } : {}),
  };
}

describe("conventions page helpers", () => {
  it("repoShortName takes the last path segment", () => {
    expect(repoShortName("acme/payments-api")).toBe("payments-api");
    expect(repoShortName("payments-api")).toBe("payments-api");
  });

  it("slugify kebab-cases a rule and never returns empty", () => {
    expect(slugify("Always use async/await instead of .then() chains")).toBe(
      "always-use-async-await-instead-of-then-chains",
    );
    expect(slugify("!!!")).toBe("rule");
  });

  it("buildSkillName / buildSkillDescription derive from the repo", () => {
    expect(buildSkillName("acme/payments-api")).toBe("payments-api-conventions");
    expect(buildSkillDescription("acme/payments-api", 3)).toBe(
      "3 house conventions extracted from payments-api",
    );
    expect(buildSkillDescription("acme/payments-api", 1)).toBe(
      "1 house convention extracted from payments-api",
    );
  });

  it("buildSkillBody merges accepted candidates into one directive doc", () => {
    const body = buildSkillBody("acme/payments-api", [
      cand({ rule: "Always use async/await", evidence_path: "src/api/users.ts:23-31" }),
      cand({ id: "c2", rule: "Redis via singleton", evidence_path: "src/lib/redis.ts:1-9" }),
    ]);

    expect(body).toContain("# payments-api-conventions");
    expect(body).toContain("House conventions for `payments-api`");
    expect(body).toContain("## always-use-async-await");
    expect(body).toContain("## redis-via-singleton");
    expect(body).toContain("Detected in `src/api/users.ts:23-31`");
    // both sections present
    expect(body.match(/^## /gm)).toHaveLength(2);
  });
});
