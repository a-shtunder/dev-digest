/* Project Context — /repos/:repoId/project-context. Server Component shell:
   resolves the dynamic route param and hands off to the client view, which
   owns all data fetching (useProjectContext/useDocument/useSaveDocument). */
import { ProjectContextView } from "./_components/ProjectContextView/ProjectContextView";

export default async function ProjectContextPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ProjectContextView repoId={repoId} />;
}
