import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

describe("nav", () => {
  it("registers the Eval Dashboard entry under SKILLS LAB with a free gKey", () => {
    const skillsLab = NAV.find((g) => g.section === "SKILLS LAB");
    expect(skillsLab).toBeDefined();

    const evalItem = skillsLab!.items.find((it) => it.key === "eval");
    expect(evalItem).toMatchObject({ key: "eval", href: "/eval" });

    // gKey must be unique across every nav item (keyboard shortcut collision guard).
    const gKeys = NAV.flatMap((g) => g.items).map((it) => it.gKey).filter(Boolean);
    expect(new Set(gKeys).size).toBe(gKeys.length);
  });
});
