import { WorkspaceConfigure } from "@/features/settings/workspace-configure";
import { requireOrganization } from "@/lib/route/organization";
import { loadAiWorkspace } from "@/lib/application/ai/workspace";
import { AiWorkspace } from "@/features/ai/workspace";
export const dynamic = "force-dynamic";
export default async function AiPage({
  params,
  searchParams,
}: PageProps<"/organizations/[organizationId]/ai">) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const query = await searchParams;
  const filters = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      typeof value === "string" ? value : "",
    ]),
  );
  const data = await loadAiWorkspace(db, organizationId, filters);
  return (
    <AiWorkspace
      organizationId={organizationId}
      data={data}
      configure={<WorkspaceConfigure organizationId={organizationId} workspace="ai" />}
      canManage={organization.capabilities.includes("organization.manage")}
    />
  );
}
