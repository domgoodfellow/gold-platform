import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/route/organization";
import { loadAiWorkspace } from "@/lib/application/ai/workspace";
import { AgentWorkbench } from "@/features/ai/workbench";
import { requireActor } from "@/lib/domain/tenancy/actor";
export const dynamic = "force-dynamic";
export default async function AgentPage({
  params,
}: {
  params: Promise<{ organizationId: string; agentId: string }>;
}) {
  const { organizationId, agentId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const actor = await requireActor(db);
  const data = await loadAiWorkspace(db, organizationId, { agentId });
  const result = await db
    .from("ai_assistants")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", agentId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) notFound();
  return (
    <AgentWorkbench
      key={agentId}
      organizationId={organizationId}
      userId={actor.id}
      agent={result.data}
      data={data}
      canManage={organization.capabilities.includes("organization.manage")}
    />
  );
}
