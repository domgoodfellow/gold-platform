import { notFound } from "next/navigation";
import { requireConfigurationTarget } from "@/lib/route/workspace-configuration";
import { loadAiWorkspace } from "@/lib/application/ai/workspace";
import { AgentWorkbench } from "@/features/ai/workbench";
import { requireActor } from "@/lib/domain/tenancy/actor";
import { listAgentTools } from "@/lib/domain/integrations/tool-access";
export const dynamic = "force-dynamic";
export default async function AgentPage({
  params,
}: {
  params: Promise<{ organizationId: string; agentId: string }>;
}) {
  const { organizationId, agentId } = await params;
  const { db, organization } = await requireConfigurationTarget(organizationId, "ai-agents");
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
  // Only people who manage integrations can read grants; for anyone else the list is simply empty.
  const connectedTools = organization.capabilities.includes("integration.manage")
    ? await listAgentTools(db, { organizationId, agentId }).catch(() => [])
    : [];
  return (
    <AgentWorkbench
      key={agentId}
      organizationId={organizationId}
      userId={actor.id}
      agent={result.data}
      data={data}
      connectedTools={connectedTools}
      canManage={organization.capabilities.includes("organization.manage")}
    />
  );
}
