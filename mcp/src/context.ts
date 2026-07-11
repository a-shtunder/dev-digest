import type { Container } from '@server/platform/container.js';
import { RepoService } from '@server/modules/repos/service.js';

/**
 * Single-tenant workspace resolution for MCP tools (no HTTP request to read
 * auth from). `LocalNoAuthProvider.currentWorkspace()` ignores its `req`
 * param entirely and always returns the seeded default workspace — same as
 * every Fastify route gets via `getContext(container, req)`.
 */
export async function resolveContext(container: Container): Promise<{ workspaceId: string }> {
  const workspace = await container.auth.currentWorkspace(undefined);
  return { workspaceId: workspace.id };
}

/**
 * Resolve a human `"owner/name"` identifier to a repo — only through
 * `RepoService` (never `container.reposRepo`/`repository.ts` directly; MCP
 * tools are a presentation-layer-equivalent and must go through a service,
 * same rule Fastify routes follow).
 */
export async function resolveRepo(container: Container, workspaceId: string, repo: string) {
  const found = await new RepoService(container).getByFullName(workspaceId, repo);
  if (!found) {
    throw new Error(`Repo '${repo}' not found — repo must be 'owner/name' (a full name), not an internal id.`);
  }
  return found;
}
