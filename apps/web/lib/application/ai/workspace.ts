import type { Db } from "@/lib/db/types";
import {
  readAgentResources,
  deploymentReadiness,
} from "@/lib/domain/ai/agents";
import { DomainError } from "@/lib/domain/errors";
import { organizationAllowanceStates } from '@/lib/domain/commercial/allowances';

export async function loadAiWorkspace(
  db: Db,
  organizationId: string,
  filters: {
    q?: string;
    status?: string;
    days?: string;
    outcome?: string;
    agentId?: string;
  } = {},
) {
  const days = filters.days === "7" ? 7 : 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let runsQuery = db
    .from("agent_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(30);
  if (["answered", "unanswered", "failed"].includes(filters.outcome ?? ""))
    runsQuery = runsQuery.eq("outcome", filters.outcome!);
  if (filters.q) runsQuery = runsQuery.ilike("question", `%${filters.q.replace(/[%_\\]/g, "")}%`);
  const [resources, summary, entitlement, runs, threads, usage] = await Promise.all([
    readAgentResources(db, organizationId, filters.q, filters.status, filters.agentId),
    db.rpc("ai_workspace_summary", {
      p_organization_id: organizationId,
      p_since: since,
    }),
    db.rpc("organization_module_entitled", {
      p_organization_id: organizationId,
      p_module_key: "assistant",
    }),
    runsQuery,
    db
      .from("communication_threads")
      .select("id,channel,state,updated_at,public_site_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(30),
    organizationAllowanceStates(db, { organizationId }).then(items => ({ available: true, items: items.filter(a => a.meterId?.startsWith('ai_') || a.allowanceKey.includes('ai')) })).catch(() => ({ available: false, items: [] })),
  ]);
  for (const result of [summary, entitlement, runs, threads])
    if (result.error)
      throw new DomainError(result.error.message, "ai.read_failed");
  const entitled = entitlement.data === true;
  const runtimeConfigured = Boolean(process.env.ASSISTANT_API_URL);
  return {
    ...resources,
    days,
    entitled,
    usage,
    summary: summary.data as {
      agents: number;
      deployments: number;
      operatorInteractions: number;
      failures: number;
      approvals: number;
      handoffs: number;
    },
    runs: runs.data ?? [],
    threads: threads.data ?? [],
    readiness: resources.deployments.map((d) => ({
      id: d.id,
      ...deploymentReadiness(
        d,
        resources.agentStates.find((a) => a.id === d.assistant_id),
        entitled,
        runtimeConfigured &&
          (d.surface !== "website_chat" ||
            Boolean(process.env.PUBLIC_CHAT_API_SECRET)),
      ),
    })),
  };
}
export type AiWorkspaceData = Awaited<ReturnType<typeof loadAiWorkspace>>;
