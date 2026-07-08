/* helpers.ts — pure builders for turning accepted convention candidates into a
   single merged skill (name + body). No React, no I/O — easy to unit-test. */
import type { ConventionCandidate } from "@devdigest/shared";

/** Last path segment of `owner/name`, e.g. "acme/payments-api" → "payments-api". */
export function repoShortName(repoFullName: string): string {
  return repoFullName.split("/").pop() || repoFullName;
}

/** kebab-case slug for a convention rule, used as its markdown section heading. */
export function slugify(rule: string): string {
  const slug = rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "rule";
}

export function buildSkillName(repoFullName: string): string {
  return `${repoShortName(repoFullName)}-conventions`;
}

export function buildSkillDescription(repoFullName: string, count: number): string {
  return `${count} house convention${count === 1 ? "" : "s"} extracted from ${repoShortName(
    repoFullName,
  )}`;
}

/** Merge accepted candidates into one directive skill body (one section each). */
export function buildSkillBody(
  repoFullName: string,
  accepted: ConventionCandidate[],
): string {
  const repo = repoShortName(repoFullName);
  const header =
    `# ${repo}-conventions\n\n` +
    `House conventions for \`${repo}\`. Flag changes that violate any rule below ` +
    `and cite the offending \`file:line\`.`;
  const sections = accepted.map(
    (c) =>
      `## ${slugify(c.rule)}\n${c.rule}\n\n` +
      `Detected in \`${c.evidence_path}\`:\n\n` +
      "```\n" +
      c.evidence_snippet +
      "\n```",
  );
  return [header, ...sections].join("\n\n");
}
