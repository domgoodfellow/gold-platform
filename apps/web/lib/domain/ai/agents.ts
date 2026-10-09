import type { Database, Db } from "@/lib/db/types";
import { DomainError } from "@/lib/domain/errors";

export type Agent = Database["public"]["Tables"]["ai_assistants"]["Row"];
export type Deployment =
  Database["public"]["Tables"]["ai_assistant_deployments"]["Row"];
export type Version =
  Database["public"]["Tables"]["ai_assistant_versions"]["Row"];
export type Evaluation =
  Database["public"]["Tables"]["ai_assistant_evaluations"]["Row"];
export type AgentConfiguration = {
  description?: string;
  purpose?: string;
  tone?: string;
  boundaries?: string;
  escalation?: string;
  tools?: string[];
  policy?: string;
};
export const CHANNELS = {
  operator_copilot: "Operator Copilot",
  website_chat: "Website",
  sms: "SMS",
  email: "Email",
  support: "Support",
  voice: "Voice",
  customer_portal: "Customer Portal",
} as const;
export type Channel = keyof typeof CHANNELS;
export const TOOL_CATALOGUE = [
  {
    key: "work_at_risk",
    name: "Work at risk",
    owner: "Work",
    description: "Overdue and unassigned work.",
    capability: "assistant.ask",
  },
  {
    key: "customers_not_contacted",
    name: "Customers not contacted",
    owner: "CRM",
    description: "Customers without recent recorded activity.",
    capability: "assistant.ask",
  },
  {
    key: "schedule_ahead",
    name: "Schedule ahead",
    owner: "Work",
    description: "Existing bookings; does not calculate free slots.",
    capability: "assistant.ask",
  },
  {
    key: "invoiced_and_incurred",
    name: "Invoiced and incurred",
    owner: "Finance",
    description: "Canonical totals, kept separate by currency.",
    capability: "assistant.ask",
  },
  {
    key: "work_marked_complete",
    name: "Work marked complete",
    owner: "Work",
    description: "Recorded work completion.",
    capability: "assistant.ask",
  },
  {
    key: "time_committed",
    name: "Time committed",
    owner: "Work",
    description: "Canonical committed time report.",
    capability: "assistant.ask",
  },
] as const;

export function configuration(agent: Agent | Version): AgentConfiguration {
  return (agent.configuration ?? {}) as AgentConfiguration;
}
export function deploymentReadiness(
  deployment: Pick<Deployment, 'surface' | 'version_id' | 'enabled'>,
  agent: Pick<Agent, "status"> | undefined,
  entitled: boolean,
  runtimeConfigured: boolean,
) {
  if (!["operator_copilot", "website_chat"].includes(deployment.surface))
    return {
      state: "Unavailable",
      reason: `${CHANNELS[deployment.surface as Channel]} conversational runtime is not implemented. Configuration only; human-supervised assistance stays in the owning workspace.`,
    };
  if (!entitled)
    return {
      state: "Unavailable",
      reason: "The organization does not hold the Agent entitlement.",
    };
  if (!agent) return { state: "Unavailable", reason: "Agent state is outside this bounded preview. Open the agent to inspect it." };
  if (agent.status !== "active")
    return { state: "Configured", reason: "Publish and activate the agent." };
  if (!deployment.version_id)
    return { state: "Configured", reason: "Select a published agent version." };
  if (!deployment.enabled)
    return { state: "Configured", reason: "Deployment is disabled." };
  if (!runtimeConfigured)
    return {
      state: "Unavailable",
      reason: "The answering service is not configured on this web deployment.",
    };
  return {
    state: "Enabled",
    reason:
      "Enabled; provider health and live channel operation require an integration test.",
  };
}

export async function readAgentResources(
  db: Db,
  organizationId: string,
  search = "",
  status = "",
  agentId?: string,
) {
  let agentsQuery = db
    .from("ai_assistants")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (search)
    agentsQuery = agentsQuery.ilike(
      "name",
      `%${search.replace(/[%_\\]/g, "")}%`,
    );
  if (["draft", "active", "disabled"].includes(status))
    agentsQuery = agentsQuery.eq("status", status);
  if (agentId) agentsQuery = agentsQuery.eq("id", agentId);
  const deploymentsQuery = db.from("ai_assistant_deployments").select("*").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(200);
  const versionsQuery = db.from("ai_assistant_versions").select("*").eq("organization_id", organizationId).order("version_number", { ascending: false }).limit(200);
  const knowledgeQuery = db.from("ai_assistant_knowledge_sources").select("*").eq("organization_id", organizationId).limit(200);
  const evaluationsQuery = db.from("ai_assistant_evaluations").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(30);
  const agentStatesQuery = db.from("ai_assistants").select("id,status").eq("organization_id", organizationId).limit(200);
  const results = await Promise.all([
    agentsQuery,
    agentId ? deploymentsQuery.eq("assistant_id", agentId) : deploymentsQuery,
    agentId ? versionsQuery.eq("assistant_id", agentId) : versionsQuery,
    agentId ? knowledgeQuery.eq("assistant_id", agentId) : knowledgeQuery,
    db.rpc('ai_published_sites', { p_organization_id: organizationId }),
    agentId ? evaluationsQuery.eq("assistant_id", agentId) : evaluationsQuery,
    agentId ? agentStatesQuery.eq("id", agentId) : agentStatesQuery,
  ]);
  for (const result of results)
    if (result.error)
      throw new DomainError(result.error.message, "ai.read_failed");
  const [agents, deployments, versions, knowledge, sites, evaluations, agentStates] =
    results;
  return {
    agents: agents.data ?? [],
    deployments: deployments.data ?? [],
    versions: versions.data ?? [],
    knowledge: knowledge.data ?? [],
    sites: sites.data ?? [],
    evaluations: evaluations.data ?? [],
    agentStates: agentStates.data ?? [],
  };
}
