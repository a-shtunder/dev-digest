/**
 * Pure application-layer helper that resolves the ordered, deduped list of
 * repo-relative spec/doc paths to inject into a run's prompt context.
 *
 * Ordering: agent-level paths first (in given order), then each loaded
 * skill's paths (in load order, each skill's own paths in given order).
 * Dedupe by exact repo-relative path string, keeping the first occurrence.
 *
 * Pure function — no filesystem, DB, or network access. This module trusts
 * its input: callers are responsible for filtering to only enabled/loaded
 * skills before calling `resolveSpecPaths`.
 */

export interface ResolveSpecPathsInput {
  agentPaths: string[];
  loadedSkills: { paths: string[] }[];
}

export function resolveSpecPaths(input: ResolveSpecPathsInput): string[] {
  const { agentPaths, loadedSkills } = input;

  const ordered: string[] = [...agentPaths];
  for (const skill of loadedSkills) {
    ordered.push(...skill.paths);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of ordered) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }

  return result;
}
