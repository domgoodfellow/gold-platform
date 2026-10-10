'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { connectMcpServer, rediscoverMcpServer, reviewMcpTool, setMcpServerEnabled, type McpTool } from '@/lib/domain/integrations/mcp';
import { decideExecution, grantTool, revokeToolGrant } from '@/lib/domain/integrations/tool-access';
import { requireOrganization } from '@/lib/route/organization';
import type { ToolState } from '@/features/integrations/mcp/tool-state';

/**
 * Server actions for MCP servers, tool review, grants and approvals. Each proves nothing itself:
 * the database refuses anyone without `integration.manage`, and `apps/api` checks it again before it
 * touches an address or a credential. These only carry the person's own session and show the answer.
 */


const CLASSIFICATIONS: readonly McpTool['classification'][] = ['unreviewed', 'read', 'write'];

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

async function run(formData: FormData, paths: (organizationId: string) => string[], work: (input: { organizationId: string; db: Awaited<ReturnType<typeof getDb>> }) => Promise<string | null>): Promise<ToolState> {
  const db = await getDb();
  const organizationId = field(formData, 'organizationId');
  await requireOrganization(organizationId);
  try {
    const notice = await work({ organizationId, db });
    for (const path of paths(organizationId)) revalidatePath(path);
    return { error: null, notice };
  } catch (error) {
    if (error instanceof DomainError) {
      for (const path of paths(organizationId)) revalidatePath(path);
      return { error: error.message, notice: null };
    }
    throw error;
  }
}

const base = (organizationId: string) => `/organizations/${organizationId}/settings/connections`;
const everywhere = (organizationId: string) => [`${base(organizationId)}/mcp`, base(organizationId)];

export async function addMcpServerAction(_previous: ToolState, formData: FormData): Promise<ToolState> {
  return run(formData, everywhere, async ({ organizationId, db }) => {
    const name = field(formData, 'name');
    const endpoint = field(formData, 'endpoint');
    if (!name) throw new DomainError('Give the server a name.', 'integrations.mcp_invalid');
    if (!endpoint) throw new DomainError('Enter the server address.', 'integrations.mcp_invalid');
    const result = await connectMcpServer(db, { organizationId, name, endpoint, bearer: field(formData, 'bearer') });
    if (!result.ok) {
      throw new DomainError(`The server was added but could not be reached: ${result.error ?? 'no answer'}`, 'integrations.mcp_unreachable');
    }
    return `Added. ${result.tools ?? 0} tool${result.tools === 1 ? '' : 's'} found; none is enabled until you review it.`;
  });
}

export async function rediscoverMcpServerAction(_previous: ToolState, formData: FormData): Promise<ToolState> {
  return run(formData, everywhere, async ({ db }) => {
    const result = await rediscoverMcpServer(db, { connectionId: field(formData, 'connectionId') });
    if (!result.ok) throw new DomainError(`The server could not be reached: ${result.error ?? 'no answer'}`, 'integrations.mcp_unreachable');
    return `Checked. ${result.tools ?? 0} tool${result.tools === 1 ? '' : 's'} found.`;
  });
}

export async function setMcpServerEnabledAction(_previous: ToolState, formData: FormData): Promise<ToolState> {
  return run(formData, everywhere, async ({ organizationId, db }) => {
    await setMcpServerEnabled(db, { organizationId, serverId: field(formData, 'serverId'), enabled: field(formData, 'enabled') === 'true' });
    return null;
  });
}

export async function reviewMcpToolAction(_previous: ToolState, formData: FormData): Promise<ToolState> {
  return run(formData, everywhere, async ({ organizationId, db }) => {
    const classification = field(formData, 'classification') as McpTool['classification'];
    if (!CLASSIFICATIONS.includes(classification)) throw new DomainError('Choose what kind of tool this is.', 'integrations.tool_invalid');
    await reviewMcpTool(db, { organizationId, toolId: field(formData, 'toolId'), classification, enabled: field(formData, 'enabled') === 'true' });
    return null;
  });
}

export async function grantToolAction(_previous: ToolState, formData: FormData): Promise<ToolState> {
  return run(formData, (organizationId) => [...everywhere(organizationId), `${base(organizationId)}/${field(formData, 'connectionId')}`], async ({ organizationId, db }) => {
    const agentId = field(formData, 'agentId');
    if (!agentId) throw new DomainError('Choose which agent may use it.', 'integrations.tool_invalid');
    await grantTool(db, {
      organizationId,
      agentId,
      mcpToolId: field(formData, 'mcpToolId') || undefined,
      connectionId: field(formData, 'mcpToolId') ? undefined : field(formData, 'connectionId') || undefined,
      capabilityKey: field(formData, 'capabilityKey') || undefined,
      resourceId: field(formData, 'resourceId') || undefined,
      requiresApproval: formData.get('requiresApproval') === 'on',
    });
    return 'Granted.';
  });
}

export async function revokeToolGrantAction(_previous: ToolState, formData: FormData): Promise<ToolState> {
  return run(formData, (organizationId) => [...everywhere(organizationId), `${base(organizationId)}/${field(formData, 'connectionId')}`], async ({ organizationId, db }) => {
    await revokeToolGrant(db, { organizationId, grantId: field(formData, 'grantId') });
    return null;
  });
}

export async function decideExecutionAction(_previous: ToolState, formData: FormData): Promise<ToolState> {
  return run(formData, everywhere, async ({ db }) => {
    const approve = field(formData, 'approve') === 'true';
    const result = await decideExecution(db, { executionId: field(formData, 'executionId'), approve });
    if (!approve) return 'Rejected.';
    if (result.decision === 'approved') return result.status === 'succeeded' ? 'Approved and run.' : 'Approved, but the call did not succeed. See recent activity.';
    if (result.decision === 'expired') return 'That request had expired.';
    return 'That request could not be run any more: its access had changed.';
  });
}
