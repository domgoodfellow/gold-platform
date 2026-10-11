import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { listConnections } from './connections';
import { listConnectors } from './connectors';
import { listMcpServers, toolError } from './mcp';

/**
 * Who may run what through a connected app, and what has happened when they did.
 *
 * A grant names one agent and one target (a native capability or an MCP tool), optionally narrowed to
 * one resource. Connected is not granted, and discovered is not granted: absence is the default, and
 * the database refuses a grant to anything that is not live. Nothing here authorizes an execution;
 * `apps/api` asks the database at the moment of the call, and this only presents the result.
 *
 * Only the operator agent can use a grant today, so that is the only principal this offers. The
 * database also holds automation grants, but no automation action can use one yet, and offering to
 * grant something that cannot run would be a control with no effect.
 */

export type Agent = { id: string; name: string };

export type ToolGrant = {
  id: string;
  agentId: string;
  targetKind: 'native' | 'mcp';
  connectionId: string | null;
  capabilityKey: string | null;
  mcpToolId: string | null;
  resourceId: string | null;
  requiresApproval: boolean;
  grantedAt: string;
};

export type Execution = {
  id: string;
  requestedAt: string;
  principalKind: 'assistant' | 'automation';
  principalId: string;
  targetKind: 'native' | 'mcp' | null;
  connectorKey: string | null;
  capabilityKey: string | null;
  toolName: string | null;
  decision: 'allowed' | 'refused' | 'approval_required';
  refusalReason: string | null;
  approvalState: string;
  status: 'refused' | 'pending_approval' | 'running' | 'succeeded' | 'failed' | 'rejected' | 'expired';
  errorClass: string | null;
  durationMs: number | null;
  /** Present only while the request waits for a decision. */
  pendingArguments: Record<string, unknown> | null;
  expiresAt: string | null;
};

/** The agents that can use a grant: the operator agent, whose deployment is switched on. */
export async function listGrantableAgents(db: Db, input: { organizationId: string }): Promise<Agent[]> {
  const { data, error } = await db
    .from('ai_assistant_deployments')
    .select('assistant_id, ai_assistants ( id, name, status )')
    .eq('organization_id', input.organizationId)
    .eq('surface', 'operator_copilot')
    .eq('enabled', true);
  if (error) throw new DomainError(error.message, 'integrations.agents_list_failed');
  const agents = new Map<string, Agent>();
  for (const row of data ?? []) {
    const assistant = Array.isArray(row.ai_assistants) ? row.ai_assistants[0] : row.ai_assistants;
    if (assistant && assistant.status === 'active') agents.set(assistant.id, { id: assistant.id, name: assistant.name });
  }
  return [...agents.values()];
}

export async function listActiveGrants(db: Db, input: { organizationId: string }): Promise<ToolGrant[]> {
  const { data, error } = await db
    .from('integration_tool_grants')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('status', 'active')
    .not('assistant_id', 'is', null)
    .order('granted_at');
  if (error) throw new DomainError(error.message, 'integrations.grants_list_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    agentId: row.assistant_id as string,
    targetKind: row.target_kind as ToolGrant['targetKind'],
    connectionId: row.connection_id,
    capabilityKey: row.capability_key,
    mcpToolId: row.mcp_tool_id,
    resourceId: row.resource_id,
    requiresApproval: row.requires_approval,
    grantedAt: row.granted_at,
  }));
}

// Named, because a stored result is the one column a signed-in role may not read.
const EXECUTION_COLUMNS =
  'id, requested_at, principal_kind, principal_id, target_kind, connector_key, capability_key, tool_name, decision, refusal_reason, approval_state, status, error_class, duration_ms, pending_arguments, expires_at';

export async function listExecutions(db: Db, input: { organizationId: string; limit?: number }): Promise<Execution[]> {
  const { data, error } = await db
    .from('integration_executions')
    .select(EXECUTION_COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('requested_at', { ascending: false })
    .limit(input.limit ?? 25);
  if (error) throw new DomainError(error.message, 'integrations.executions_list_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    requestedAt: row.requested_at,
    principalKind: row.principal_kind as Execution['principalKind'],
    principalId: row.principal_id,
    targetKind: row.target_kind as Execution['targetKind'],
    connectorKey: row.connector_key,
    capabilityKey: row.capability_key,
    toolName: row.tool_name,
    decision: row.decision as Execution['decision'],
    refusalReason: row.refusal_reason,
    approvalState: row.approval_state,
    status: row.status as Execution['status'],
    errorClass: row.error_class,
    durationMs: row.duration_ms,
    pendingArguments:
      row.pending_arguments && typeof row.pending_arguments === 'object' && !Array.isArray(row.pending_arguments)
        ? (row.pending_arguments as Record<string, unknown>)
        : null,
    expiresAt: row.expires_at,
  }));
}

export async function grantTool(
  db: Db,
  input: {
    organizationId: string;
    agentId: string;
    connectionId?: string;
    capabilityKey?: string;
    mcpToolId?: string;
    resourceId?: string;
    requiresApproval?: boolean;
  },
): Promise<string> {
  const { data, error } = await db.rpc('grant_integration_tool', {
    p_organization_id: input.organizationId,
    p_assistant_id: input.agentId,
    // The function takes every target as a nullable argument; the generated types cannot say so.
    p_automation_rule_id: null as unknown as string,
    p_connection_id: (input.connectionId ?? null) as string,
    p_capability_key: (input.capabilityKey ?? null) as string,
    p_mcp_tool_id: (input.mcpToolId ?? null) as string,
    p_resource_id: (input.resourceId ?? null) as string,
    p_requires_approval: input.requiresApproval ?? false,
  });
  if (error) throw toolError(error);
  return data as string;
}

export async function revokeToolGrant(db: Db, input: { organizationId: string; grantId: string }): Promise<void> {
  const { error } = await db.rpc('revoke_integration_tool_grant', {
    p_organization_id: input.organizationId,
    p_grant_id: input.grantId,
  });
  if (error) throw toolError(error);
}

/** Approve (and run) or reject a waiting request. What runs is what the database stored, not what is sent. */
export async function decideExecution(
  db: Db,
  input: { executionId: string; approve: boolean },
): Promise<{ decision: string; status?: string; reason?: string | null }> {
  return callDomainCommand('/integrations/operate', {
    token: await requireAccessToken(db),
    body: { operation: 'approve_execution', arguments: { execution_id: input.executionId, approve: input.approve } },
    timeoutMs: 60_000,
  });
}

export type ToolField = { name: string; label: string; kind: 'text' | 'whole number'; required: boolean };

export type NativeCapability = {
  key: string;
  summary: string;
  workspace: string;
  writes: boolean;
  resourceType: string | null;
  inputs: string[];
  /** What it can be asked, in words a person can fill in. */
  fields: ToolField[];
};

/** What a connector declares it can do. A fact about the deployed code, so it reads no business. */
export async function listNativeCapabilities(db: Db, input: { connectorKey: string }): Promise<NativeCapability[]> {
  try {
    const answer = await callDomainCommand<{
      connectors: { connector_key: string; capabilities: { key: string; summary: string; workspace: string; writes: boolean; resource_type: string | null; inputs: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } }[] }[];
    }>('/integrations/operate', {
      token: await requireAccessToken(db),
      body: { operation: 'capabilities', arguments: { connector_keys: [input.connectorKey] } },
      timeoutMs: 4_000,
    });
    return (answer.connectors[0]?.capabilities ?? [])
      .filter((capability) => !capability.writes)
      .map((capability) => ({
        key: capability.key,
        summary: capability.summary,
        workspace: capability.workspace,
        writes: capability.writes,
        resourceType: capability.resource_type,
        inputs: Object.keys(capability.inputs?.properties ?? {}),
        // A page marker means nothing to a person filling in a form, and a rule has no earlier page to continue.
        fields: Object.entries(capability.inputs?.properties ?? {}).filter(([name]) => name !== 'after').map(([name, spec]) => ({
          name,
          label: (spec.description ?? name).replace(/\.$/, ''),
          kind: spec.type === 'integer' ? ('whole number' as const) : ('text' as const),
          required: (capability.inputs?.required ?? []).includes(name),
        })),
      }));
  } catch (error) {
    if (error instanceof DomainError) return []; // the API is not reachable: offer nothing rather than guess
    throw error;
  }
}

export type AgentTool = { id: string; label: string; source: string; needsApproval: boolean };

/**
 * What one agent has been given, in words a person can read: the tools and capabilities granted to it,
 * each with where it comes from. The agent's own editor shows this; the grants are managed in
 * Connections, which is the one place they are made and withdrawn.
 */
export async function listAgentTools(db: Db, input: { organizationId: string; agentId: string }): Promise<AgentTool[]> {
  const grants = (await listActiveGrants(db, { organizationId: input.organizationId })).filter((grant) => grant.agentId === input.agentId);
  if (grants.length === 0) return [];

  const [servers, connections, connectors] = await Promise.all([
    listMcpServers(db, { organizationId: input.organizationId }),
    listConnections(db, { organizationId: input.organizationId }),
    listConnectors(db),
  ]);
  const tools = new Map(servers.flatMap((server) => server.tools.map((tool) => [tool.id, { tool, server }] as const)));
  const connectorName = new Map(connectors.map((connector) => [connector.key, connector.name]));
  const connectionConnector = new Map(connections.map((connection) => [connection.id, connection.connectorKey]));

  const summaries = new Map<string, string>();
  for (const key of new Set(grants.flatMap((grant) => (grant.connectionId ? [connectionConnector.get(grant.connectionId)] : [])))) {
    if (!key) continue;
    for (const capability of await listNativeCapabilities(db, { connectorKey: key })) summaries.set(`${key}:${capability.key}`, capability.summary);
  }

  return grants.map((grant) => {
    if (grant.targetKind === 'mcp') {
      const found = grant.mcpToolId ? tools.get(grant.mcpToolId) : undefined;
      return { id: grant.id, label: found?.tool.name ?? 'An MCP tool', source: found?.server.name ?? 'MCP server', needsApproval: true };
    }
    const key = grant.connectionId ? connectionConnector.get(grant.connectionId) : undefined;
    return {
      id: grant.id,
      label: (key && grant.capabilityKey ? summaries.get(`${key}:${grant.capabilityKey}`) : undefined) ?? grant.capabilityKey ?? 'A capability',
      source: key ? (connectorName.get(key) ?? key) : 'A connected app',
      needsApproval: grant.requiresApproval,
    };
  });
}

export type ToolChoice = { connectionId: string; connectorName: string; accountLabel: string | null; capabilities: NativeCapability[] };

/**
 * What an automation could be told to read: the capabilities of this business's active connections to
 * connected apps. Offered only to someone who manages both automations and integrations, because wiring
 * one in creates a grant.
 */
export async function listToolChoices(db: Db, input: { organizationId: string }): Promise<ToolChoice[]> {
  const [connections, connectors] = await Promise.all([
    listConnections(db, { organizationId: input.organizationId }),
    listConnectors(db),
  ]);
  const native = new Map(connectors.filter((connector) => connector.connectionMethod === 'native').map((connector) => [connector.key, connector]));
  const choices: ToolChoice[] = [];
  const known = new Map<string, NativeCapability[]>();
  for (const connection of connections) {
    const connector = native.get(connection.connectorKey);
    if (!connector || connection.status !== 'active') continue;
    if (!known.has(connector.key)) known.set(connector.key, await listNativeCapabilities(db, { connectorKey: connector.key }));
    const capabilities = known.get(connector.key) ?? [];
    if (capabilities.length > 0) {
      choices.push({ connectionId: connection.id, connectorName: connector.name, accountLabel: connection.accountLabel, capabilities });
    }
  }
  return choices;
}
