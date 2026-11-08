import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * A business's MCP servers and the tools they advertise.
 *
 * **Four different facts, never one status.** A server is *connected* (a connection exists and its
 * credential is stored), *discovered* (its tools were listed), *enabled* (the business switched it on)
 * and *healthy* (the last check worked). A tool is *discovered* (the server listed it), *enabled* (a
 * person reviewed it and offered it) and *granted* (to one agent, in `tool-access.ts`). Nothing here
 * decides which of those is true on another's behalf.
 *
 * The server address is checked and the credential stored by `apps/api`; this runtime sends it the
 * person's token and a one-time bearer value and never reads one back.
 */

export type McpTool = {
  id: string;
  serverId: string;
  name: string;
  description: string;
  /** The server's own claim. Shown as a claim; never a reason to skip a review or an approval. */
  reportedReadOnly: boolean | null;
  classification: 'unreviewed' | 'read' | 'write';
  enabled: boolean;
  status: 'available' | 'removed';
  lastSeenAt: string;
  reviewedAt: string | null;
};

export type McpServer = {
  id: string;
  connectionId: string;
  name: string;
  endpoint: string;
  enabled: boolean;
  protocolVersion: string | null;
  serverName: string | null;
  discoveryStatus: 'never' | 'succeeded' | 'failed';
  lastDiscoveredAt: string | null;
  lastDiscoveryError: string | null;
  tools: McpTool[];
};

export async function listMcpServers(db: Db, input: { organizationId: string }): Promise<McpServer[]> {
  const [servers, tools] = await Promise.all([
    db.from('integration_mcp_servers').select('*').eq('organization_id', input.organizationId).order('created_at'),
    db.from('integration_mcp_tools').select('*').eq('organization_id', input.organizationId).order('name'),
  ]);
  if (servers.error) throw fromDatabaseError(servers.error, 'integrations.mcp_list_failed');
  if (tools.error) throw fromDatabaseError(tools.error, 'integrations.mcp_list_failed');

  return (servers.data ?? []).map((server) => ({
    id: server.id,
    connectionId: server.connection_id,
    name: server.name,
    endpoint: server.endpoint,
    enabled: server.enabled,
    protocolVersion: server.protocol_version,
    serverName: server.server_name,
    discoveryStatus: server.discovery_status as McpServer['discoveryStatus'],
    lastDiscoveredAt: server.last_discovered_at,
    lastDiscoveryError: server.last_discovery_error,
    tools: (tools.data ?? [])
      .filter((tool) => tool.server_id === server.id)
      .map((tool) => ({
        id: tool.id,
        serverId: tool.server_id,
        name: tool.name,
        description: tool.description,
        reportedReadOnly: tool.read_only_hint,
        classification: tool.classification as McpTool['classification'],
        enabled: tool.enabled,
        status: tool.status as McpTool['status'],
        lastSeenAt: tool.last_seen_at,
        reviewedAt: tool.reviewed_at,
      })),
  }));
}

async function operate<T>(db: Db, operation: string, args: Record<string, unknown>): Promise<T> {
  return callDomainCommand<T>('/integrations/operate', {
    token: await requireAccessToken(db),
    body: { operation, arguments: args },
    // A server that is slow to answer is the reason for the wait: initialize and one listing.
    timeoutMs: 60_000,
  });
}

export type McpDiscoveryResult = { connection_id: string; server_id: string; ok: boolean; tools?: number; error?: string };

/** Registers the server, stores its credential and discovers its tools. Enables nothing. */
export function connectMcpServer(
  db: Db,
  input: { organizationId: string; name: string; endpoint: string; bearer?: string },
): Promise<McpDiscoveryResult> {
  return operate(db, 'mcp_connect', {
    organization_id: input.organizationId,
    name: input.name,
    endpoint: input.endpoint,
    bearer: input.bearer?.trim() ? input.bearer.trim() : null,
  });
}

/** Tests the server again and refreshes its tools. A changed tool comes back unreviewed and off. */
export function rediscoverMcpServer(db: Db, input: { connectionId: string }): Promise<{ ok: boolean; tools?: number; error?: string }> {
  return operate(db, 'mcp_discover', { connection_id: input.connectionId });
}

export async function reviewMcpTool(
  db: Db,
  input: { organizationId: string; toolId: string; classification: McpTool['classification']; enabled: boolean },
): Promise<void> {
  const { error } = await db.rpc('review_mcp_tool', {
    p_organization_id: input.organizationId,
    p_tool_id: input.toolId,
    p_classification: input.classification,
    p_enabled: input.enabled,
  });
  if (error) throw toolError(error);
}

export async function setMcpServerEnabled(db: Db, input: { organizationId: string; serverId: string; enabled: boolean }): Promise<void> {
  const { error } = await db.rpc('set_mcp_server_enabled', {
    p_organization_id: input.organizationId,
    p_server_id: input.serverId,
    p_enabled: input.enabled,
  });
  if (error) throw toolError(error);
}

export function toolError(error: { code?: string; message: string }): DomainError {
  if (error.code === '42501') return new DomainError('You cannot change integrations for this business.', 'integrations.forbidden');
  if (error.code === '22023') return fromDatabaseError(error, 'integrations.tool_invalid');
  if (error.code === '23505') return new DomainError('That is already granted.', 'integrations.tool_duplicate');
  return new DomainError('That could not be completed.', 'integrations.tool_failed');
}
