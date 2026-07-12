/**
 * Project Context HTTP module. Thin Fastify plugin — validates via Zod,
 * delegates to `ProjectContextService`, returns the result. No business
 * logic here (onion: presentation layer).
 *
 *   GET /repos/:repoId/project-context                → { documents, summary }
 *   GET /repos/:repoId/project-context/document?path= → DocumentContent
 *   PUT /repos/:repoId/project-context/document        → DocumentContent
 *
 * A guard violation (path traversal / symlink escape) surfaces as the
 * `ValidationError` thrown by `path-guard.ts`, mapped by the app-level error
 * handler to its own `statusCode` (422); a missing file is mapped to 404 by
 * the service before it reaches this layer.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DiscoveredDocument, DiscoverySummary, DocumentContent, SaveDocumentBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { ProjectContextService } from './service.js';

const RepoIdParams = z.object({ repoId: z.string().uuid() });

const ProjectContextResponse = z.object({
  documents: z.array(DiscoveredDocument),
  summary: DiscoverySummary,
});

const DocumentQuery = z.object({ path: z.string().min(1) });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/repos/:repoId/project-context',
    { schema: { params: RepoIdParams, response: { 200: ProjectContextResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ProjectContextService(app.container);
      return service.listForRepo(workspaceId, req.params.repoId);
    },
  );

  app.get(
    '/repos/:repoId/project-context/document',
    { schema: { params: RepoIdParams, querystring: DocumentQuery, response: { 200: DocumentContent } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ProjectContextService(app.container);
      return service.readDocument(workspaceId, req.params.repoId, req.query.path);
    },
  );

  app.put(
    '/repos/:repoId/project-context/document',
    { schema: { params: RepoIdParams, body: SaveDocumentBody, response: { 200: DocumentContent } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ProjectContextService(app.container);
      return service.saveDocument(workspaceId, req.params.repoId, req.body.path, req.body.text);
    },
  );
}
