import { WorkspaceConfigurationLayout } from '@/features/settings/workspace-configuration';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
import { WorkspaceConfigure } from "@/features/settings/workspace-configure";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/route/organization";
import { loadAiWorkspace } from "@/lib/application/ai/workspace";
import { AiWorkspace } from "@/features/ai/workspace";
export const dynamic = "force-dynamic";
export default async function AiCollection({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, view } = await params;
  if (
    ![
      "agents",
      "deployments",
      "knowledge",
      "tools",
      "activity",
      "evaluations",
    ].includes(view)
  )
    notFound();
  const configuring = ['agents', 'deployments', 'knowledge', 'tools'].includes(view);
  const { db, organization } = configuring ? await requireConfigurationTarget(organizationId, `ai-${view}`) : await requireOrganization(organizationId);
  const query = await searchParams;
  const filters = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      typeof value === "string" ? value : "",
    ]),
  );
  const data = await loadAiWorkspace(db, organizationId, filters);
  const content = (
    <AiWorkspace
      organizationId={organizationId}
      data={data}
      configure={configuring ? undefined : <WorkspaceConfigure organizationId={organizationId} workspace="ai" />}
      view={view}
      canManage={organization.capabilities.includes("organization.manage")}
    />
  );
  return configuring ? <WorkspaceConfigurationLayout organizationId={organizationId} workspace="ai">{content}</WorkspaceConfigurationLayout> : content;
}
