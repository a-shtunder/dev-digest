import { describe, it, expect, vi } from "vitest";
import { SkillsRepository } from "./repository.js";
import type { Db } from "../../db/client.js";
import type { SkillRow } from "../../db/rows.js";

/**
 * Hermetic unit test — a minimal fake `Db` mimicking Drizzle's fluent
 * `update().set().where().returning()` chain. Verifies `setAttachedDocs`
 * writes ONLY `attachedDocPaths` (T9 / AC-14): it must never bump `version`,
 * reset `threatLevel`, or touch `evidenceFiles` / `body` — those fields are
 * the general `update()` path's job, not this dedicated attach-only method.
 */
function buildDb(returned: Partial<SkillRow>) {
  const returningMock = vi.fn().mockResolvedValue([returned as SkillRow]);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });

  const db = { update: updateMock } as unknown as Db;
  return { db, updateMock, setMock, whereMock, returningMock };
}

describe("SkillsRepository.setAttachedDocs", () => {
  it("persists ordered paths and leaves version, evidence_files, threat_level untouched", async () => {
    const existingRow: Partial<SkillRow> = {
      id: "skill-1",
      workspaceId: "ws-1",
      name: "My Skill",
      version: 3,
      evidenceFiles: ["old-evidence.md"],
      threatLevel: "safe",
      attachedDocPaths: ["docs/a.md", "docs/b.md"],
    };
    const { db, setMock } = buildDb(existingRow);
    const repo = new SkillsRepository(db);

    const row = await repo.setAttachedDocs("ws-1", "skill-1", [
      "docs/a.md",
      "docs/b.md",
    ]);

    // Only `attachedDocPaths` is written — no version/threatLevel/evidenceFiles/body.
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({
      attachedDocPaths: ["docs/a.md", "docs/b.md"],
    });

    // Returned row still carries the unrelated fields unchanged (as the DB would return them).
    expect(row?.version).toBe(3);
    expect(row?.evidenceFiles).toEqual(["old-evidence.md"]);
    expect(row?.threatLevel).toBe("safe");
    expect(row?.attachedDocPaths).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("returns undefined when the skill does not exist in the workspace", async () => {
    const returningMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const updateMock = vi.fn().mockReturnValue({ set: setMock });
    const db = { update: updateMock } as unknown as Db;
    const repo = new SkillsRepository(db);

    const row = await repo.setAttachedDocs("ws-1", "missing", ["a.md"]);

    expect(row).toBeUndefined();
  });
});
