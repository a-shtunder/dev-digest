import { z } from "zod";

/**
 * Project Context — discovered repo documents (specs/docs/insights) that can
 * be attached to an agent or skill's prompt, plus read/write of their content.
 *
 * Mirrors server/src/vendor/shared/contracts/project-context.ts. The client
 * `@devdigest/shared` alias resolves to this local copy, not the server's —
 * keep both in sync (additive only).
 */

// ---- Discovery ----
export const DiscoveredDocumentBucket = z.enum(["specs", "docs", "insights"]);
export type DiscoveredDocumentBucket = z.infer<
  typeof DiscoveredDocumentBucket
>;

export const DiscoveredDocument = z.object({
  path: z.string(),
  bucket: DiscoveredDocumentBucket,
  estimated_tokens: z.number().int(),
  used_by_agents: z.number().int().optional(),
});
export type DiscoveredDocument = z.infer<typeof DiscoveredDocument>;

export const DiscoverySummary = z.object({
  document_count: z.number().int(),
  total_estimated_tokens: z.number().int(),
  refreshed_at: z.string(), // ISO timestamp
  clone_available: z.boolean(),
});
export type DiscoverySummary = z.infer<typeof DiscoverySummary>;

// ---- Document content ----
export const DocumentContent = z.object({
  path: z.string(),
  text: z.string(),
});
export type DocumentContent = z.infer<typeof DocumentContent>;

// ---- Request bodies ----
export const SetAttachedDocsBody = z.object({
  paths: z.array(z.string()), // ordered
});
export type SetAttachedDocsBody = z.infer<typeof SetAttachedDocsBody>;

export const SaveDocumentBody = z.object({
  path: z.string(),
  text: z.string(),
});
export type SaveDocumentBody = z.infer<typeof SaveDocumentBody>;
