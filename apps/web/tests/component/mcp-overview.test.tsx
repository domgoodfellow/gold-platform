// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionCapabilities } from '@/features/integrations/connections/connection-capabilities';
import { McpOverview } from '@/features/integrations/mcp/mcp-overview';
import type { IntegrationConnection } from '@/lib/domain/integrations/connections';
import type { McpServer, McpTool } from '@/lib/domain/integrations/mcp';
import type { Execution, ToolGrant } from '@/lib/domain/integrations/tool-access';

// The controls call server actions; what is under test here is what the screen offers and says.
vi.mock('@/features/integrations/mcp/mcp-controls', () => ({
  AddServerDialog: () => <button>Add a server</button>,
  ApprovalQueue: ({ requests }: { requests: { id: string; title: string }[] }) => (
    <ul>{requests.map((request) => <li key={request.id}>{request.title}</li>)}</ul>
  ),
  GrantForm: ({ agents, alwaysAsks }: { agents: { name: string }[]; alwaysAsks?: boolean }) => (
    <div>Grant to {agents.map((agent) => agent.name).join(', ') || 'nobody'}{alwaysAsks ? ' (always asks)' : ''}</div>
  ),
  RevokeGrantForm: ({ agentName }: { agentName: string }) => <button>Withdraw access from {agentName}</button>,
  ServerSwitch: ({ enabled }: { enabled: boolean }) => <button>{enabled ? 'Switch off' : 'Switch on'}</button>,
  TestServerForm: () => <button>Test and refresh</button>,
  ToolReviewForm: ({ tool }: { tool: McpTool }) => <button>{tool.enabled ? 'Disable' : 'Enable'} {tool.name}</button>,
}));
vi.mock('@/features/integrations/connections/connection-controls', () => ({ DisconnectForm: () => <button>Disconnect</button> }));

afterEach(cleanup);

const ORG = 'org';
const agents = [{ id: 'agent-1', name: 'Copilot' }];

function tool(overrides: Partial<McpTool>): McpTool {
  return {
    id: 't1', serverId: 's1', name: 'search', description: 'Search things', reportedReadOnly: true, classification: 'unreviewed',
    enabled: false, status: 'available', lastSeenAt: '2026-10-10T10:00:00Z', reviewedAt: null, ...overrides,
  };
}
function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 's1', connectionId: 'c1', name: 'Invoices', endpoint: 'https://mcp.example.com/mcp', enabled: true, protocolVersion: '2025-06-18',
    serverName: 'Demo', discoveryStatus: 'succeeded', lastDiscoveredAt: '2026-10-10T10:00:00Z', lastDiscoveryError: null,
    tools: [tool({})], ...overrides,
  };
}
function connection(status: IntegrationConnection['status'] = 'active'): IntegrationConnection {
  return { id: 'c1', connectorKey: 'mcp_server', accountLabel: 'Invoices', status, scopes: [], lastError: null, connectedBy: 'u', lastVerifiedAt: null, createdAt: '2026-10-10T10:00:00Z' };
}
function render_(props: Partial<Parameters<typeof McpOverview>[0]> = {}) {
  return render(
    <McpOverview organizationId={ORG} servers={[server()]} connections={[connection()]} grants={[]} agents={agents} executions={[]} mayManage {...props} />,
  );
}

describe('MCP servers', () => {
  it('shows connected, found, switched on and healthy as four separate facts', () => {
    render_();
    const status = screen.getByRole('list', { name: 'Status' });
    for (const text of ['Connected', '1 tool found', 'Switched on', 'Healthy']) expect(within(status).getByText(text)).toBeInTheDocument();
  });

  it('does not call a server healthy because it is connected', () => {
    render_({ servers: [server({ discoveryStatus: 'failed', lastDiscoveryError: 'bad token' })] });
    expect(screen.getByText('Not healthy')).toBeInTheDocument();
    expect(screen.getByText('Last check failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('bad token');
  });

  it('offers review but no way to give a tool away until it is enabled', () => {
    render_();
    expect(screen.getAllByRole('button', { name: 'Enable search' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enable the tool first.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Grant to/)).not.toBeInTheDocument();
  });

  it('offers a grant for an enabled tool, always asking a person, to agents that do not hold it yet', () => {
    const grants: ToolGrant[] = [];
    render_({ servers: [server({ tools: [tool({ enabled: true, classification: 'read' })] })], grants });
    expect(screen.getAllByText('Grant to Copilot (always asks)').length).toBeGreaterThan(0);
  });

  it('shows who holds a tool and lets access be withdrawn, instead of offering it again', () => {
    const grants: ToolGrant[] = [
      { id: 'g1', agentId: 'agent-1', targetKind: 'mcp', connectionId: null, capabilityKey: null, mcpToolId: 't1', resourceId: null, requiresApproval: true, grantedAt: '2026-10-10T10:00:00Z' },
    ];
    render_({ servers: [server({ tools: [tool({ enabled: true, classification: 'read' })] })], grants });
    expect(screen.getAllByRole('button', { name: 'Withdraw access from Copilot' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Grant to nobody (always asks)').length).toBeGreaterThan(0);
  });

  it('presents a server’s own claim as a claim, not as a reason to trust the tool', () => {
    render_();
    expect(screen.getAllByText(/It says it only reads\. That is its claim, so it still needs your review\./).length).toBeGreaterThan(0);
  });

  it('says a tool the server stopped offering has lost its access', () => {
    render_({ servers: [server({ tools: [tool({}), tool({ id: 't2', name: 'gone', status: 'removed' })] })] });
    expect(screen.getByText(/no longer offered: gone\. Access to it has stopped\./)).toBeInTheDocument();
  });

  it('hides a disconnected server and offers no controls to a member who cannot manage', () => {
    render_({ connections: [connection('disconnected')] });
    expect(screen.getByText('No MCP servers yet')).toBeInTheDocument();
    cleanup();
    render_({ mayManage: false });
    for (const name of ['Add a server', 'Test and refresh', 'Switch off', 'Disconnect', 'Enable search']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('lists what is waiting for approval and what happened, in plain words', () => {
    const execution = (overrides: Partial<Execution>): Execution => ({
      id: 'e1', requestedAt: '2026-10-10T10:00:00Z', principalKind: 'assistant', principalId: 'agent-1', targetKind: 'mcp', connectorKey: 'mcp_server',
      capabilityKey: null, toolName: 'search', decision: 'allowed', refusalReason: null, approvalState: 'not_required', status: 'succeeded', errorClass: null,
      durationMs: 42, pendingArguments: null, expiresAt: null, ...overrides,
    });
    render_({
      executions: [
        execution({ id: 'e1', status: 'pending_approval', decision: 'approval_required', approvalState: 'pending', pendingArguments: { q: 'x' }, durationMs: null }),
        execution({ id: 'e2', status: 'refused', decision: 'refused', refusalReason: 'grant_revoked', durationMs: null }),
        execution({ id: 'e3', status: 'succeeded' }),
      ],
    });
    expect(screen.getByText('Copilot wants to use search')).toBeInTheDocument();
    expect(screen.getAllByText('Access was withdrawn').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getByText(/What was asked and what came back are not stored/)).toBeInTheDocument();
  });
});

describe('what an agent can do with a connected app', () => {
  const capabilities = [
    { key: 'crm.contacts.list', summary: 'Contacts', workspace: 'crm', writes: false, resourceType: null, inputs: ['limit'] },
    { key: 'slack.messages.history', summary: 'Recent messages in one channel', workspace: 'communications', writes: false, resourceType: 'slack_channel', inputs: ['channel_id'] },
  ];

  it('offers each read use, off until given, and says nothing here changes data', () => {
    render(<ConnectionCapabilities organizationId={ORG} connectionId="c1" capabilities={capabilities} grants={[]} agents={agents} resources={[]} />);
    expect(screen.getByText('Contacts')).toBeInTheDocument();
    expect(screen.getByText(/none of them changes anything in it/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Grant to Copilot/)).toHaveLength(2);
  });

  it('shows who holds a use and stops offering it to the same agent', () => {
    const grants: ToolGrant[] = [
      { id: 'g1', agentId: 'agent-1', targetKind: 'native', connectionId: 'c1', capabilityKey: 'crm.contacts.list', mcpToolId: null, resourceId: null, requiresApproval: true, grantedAt: '2026-10-10T10:00:00Z' },
    ];
    render(<ConnectionCapabilities organizationId={ORG} connectionId="c1" capabilities={capabilities} grants={grants} agents={agents} resources={[]} />);
    expect(screen.getByText(/a person approves each use/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw access from Copilot' })).toBeInTheDocument();
    expect(screen.getAllByText(/^Grant to/)).toHaveLength(2); // the second capability, and nobody left for the first
    expect(screen.getByText('Grant to nobody')).toBeInTheDocument();
  });

  it('renders nothing for a connector that declares no read operation', () => {
    const { container } = render(<ConnectionCapabilities organizationId={ORG} connectionId="c1" capabilities={[]} grants={[]} agents={agents} resources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
