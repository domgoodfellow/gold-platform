import type { ReactNode } from 'react';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { DisconnectForm } from '@/features/integrations/connections/connection-controls';
import type { IntegrationConnection } from '@/lib/domain/integrations/connections';
import type { McpServer, McpTool } from '@/lib/domain/integrations/mcp';
import type { Agent, Execution, ToolGrant } from '@/lib/domain/integrations/tool-access';
import { hostOf, outcomeOf, serverFacts } from '@/lib/domain/integrations/tool-labels';
import { AddServerDialog, ApprovalQueue, GrantForm, RevokeGrantForm, ServerSwitch, TestServerForm, ToolReviewForm } from './mcp-controls';

const CONNECTION_LABEL: Record<IntegrationConnection['status'], string> = {
  connecting: 'Connecting',
  active: 'Connected',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB') : '';
}

function ago(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function summarise(args: Record<string, unknown> | null): string {
  if (!args) return '';
  const text = JSON.stringify(args);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/**
 * Settings → Connections → MCP servers: configuration and review. The work an agent does with a tool
 * happens where the agent is asked (AI); this is where a business decides what it may reach.
 *
 * Each fact is shown on its own: a server is *connected*, its tools were *found*, a tool is *enabled*
 * by a person and *granted* to an agent, and the whole is *healthy* only if the last check worked.
 */
export function McpOverview({
  organizationId,
  servers,
  connections,
  grants,
  agents,
  executions,
  mayManage,
}: {
  organizationId: string;
  servers: McpServer[];
  connections: IntegrationConnection[];
  grants: ToolGrant[];
  agents: Agent[];
  executions: Execution[];
  mayManage: boolean;
}) {
  const agentName = new Map(agents.map((agent) => [agent.id, agent.name]));
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
  const waiting = executions.filter((execution) => execution.status === 'pending_approval');
  const live = servers.filter((server) => connectionById.get(server.connectionId)?.status !== 'disconnected');

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Hint className="max-w-2xl">
          An MCP server offers tools to an agent. Finding a tool does not let anyone use it: you review it, enable it, then give it to an agent, and
          a person approves each use.
        </Hint>
        {mayManage ? <AddServerDialog organizationId={organizationId} /> : null}
      </div>

      <Section className="mt-8">
        <SectionHeading>Waiting for your approval</SectionHeading>
        <ApprovalQueue
          organizationId={organizationId}
          mayManage={mayManage}
          requests={waiting.map((execution) => ({
            id: execution.id,
            title: `${agentName.get(execution.principalId) ?? 'An agent'} wants to use ${execution.toolName ?? execution.capabilityKey ?? 'a tool'}`,
            asked: ago(execution.requestedAt),
            sent: summarise(execution.pendingArguments),
          }))}
        />
        {waiting.length === 0 ? <Hint className="mt-2">Nothing is waiting. A tool from an MCP server always stops here until a person approves it.</Hint> : null}
      </Section>

      {live.length === 0 ? (
        <Section className="mt-8">
          <EmptyState
            title="No MCP servers yet"
            description="Add a server to see the tools it offers. Nothing is switched on until you have looked at it."
          />
        </Section>
      ) : (
        live.map((server) => (
          <ServerPanel
            key={server.id}
            organizationId={organizationId}
            server={server}
            connection={connectionById.get(server.connectionId)}
            grants={grants}
            agents={agents}
            agentName={agentName}
            mayManage={mayManage}
          />
        ))
      )}

      <Section className="mt-8">
        <SectionHeading>Recent activity</SectionHeading>
        <div className="mt-2">
          <DataTable
            rows={executions}
            rowKey={(execution) => execution.id}
            empty="Nothing has been run through a connected app yet."
            columns={[
              { key: 'when', header: 'When', cell: (execution) => ago(execution.requestedAt) },
              {
                key: 'who',
                header: 'Who',
                emphasis: 'primary',
                cell: (execution) =>
                  execution.principalKind === 'assistant' ? (agentName.get(execution.principalId) ?? 'An agent') : 'An automation',
              },
              {
                key: 'what',
                header: 'What',
                cell: (execution) => execution.toolName ?? execution.capabilityKey ?? (execution.status === 'refused' ? 'Not found' : ''),
              },
              {
                key: 'outcome',
                header: 'Outcome',
                cell: (execution) => {
                  const outcome = outcomeOf(execution);
                  return (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={outcome.tone}>{outcome.label}</Badge>
                      {outcome.detail ? <span className="text-sm text-muted">{outcome.detail}</span> : null}
                    </span>
                  );
                },
              },
              {
                key: 'took',
                header: 'Took',
                numeric: true,
                emphasis: 'secondary',
                cell: (execution) => (execution.durationMs === null ? '' : `${execution.durationMs} ms`),
              },
            ]}
          />
        </div>
        <Hint className="mt-2">Only what happened is kept: who, which tool, the outcome and how long it took. What was asked and what came back are not stored.</Hint>
      </Section>
    </>
  );
}

function ServerPanel({
  organizationId,
  server,
  connection,
  grants,
  agents,
  agentName,
  mayManage,
}: {
  organizationId: string;
  server: McpServer;
  connection: IntegrationConnection | undefined;
  grants: ToolGrant[];
  agents: Agent[];
  agentName: Map<string, string>;
  mayManage: boolean;
}) {
  const facts = serverFacts({ connectionStatus: connection?.status, discoveryStatus: server.discoveryStatus, enabled: server.enabled });
  const available = server.tools.filter((tool) => tool.status === 'available');
  const removed = server.tools.filter((tool) => tool.status === 'removed');

  return (
    <Section className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionHeading>{server.name}</SectionHeading>
          <p className="break-all text-sm text-muted">{hostOf(server.endpoint)}</p>
        </div>
        {mayManage ? (
          <div className="flex flex-wrap items-start gap-2">
            <TestServerForm organizationId={organizationId} connectionId={server.connectionId} />
            <ServerSwitch organizationId={organizationId} serverId={server.id} enabled={server.enabled} />
            <DisconnectForm organizationId={organizationId} connectionId={server.connectionId} />
          </div>
        ) : null}
      </div>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Status">
        <li>
          <Badge tone={facts.connected ? 'success' : 'neutral'}>{connection ? CONNECTION_LABEL[connection.status] : 'Not connected'}</Badge>
        </li>
        <li>
          <Badge tone={server.discoveryStatus === 'failed' ? 'danger' : facts.discovered ? 'success' : 'neutral'}>
            {server.discoveryStatus === 'succeeded'
              ? `${available.length} tool${available.length === 1 ? '' : 's'} found`
              : server.discoveryStatus === 'failed'
                ? 'Last check failed'
                : 'Not checked yet'}
          </Badge>
        </li>
        <li>
          <Badge tone={facts.switchedOn ? 'success' : 'neutral'}>{facts.switchedOn ? 'Switched on' : 'Switched off'}</Badge>
        </li>
        <li>
          <Badge tone={facts.healthy ? 'success' : 'danger'}>{facts.healthy ? 'Healthy' : 'Not healthy'}</Badge>
        </li>
      </ul>
      {server.discoveryStatus === 'failed' && server.lastDiscoveryError ? (
        <Hint className="mt-2 break-words" role="alert">
          {server.lastDiscoveryError}
        </Hint>
      ) : null}
      {server.lastDiscoveredAt ? <Hint className="mt-1">Last checked {when(server.lastDiscoveredAt)}.</Hint> : null}

      <div className="mt-4">
        <DataTable
          rows={available}
          rowKey={(tool) => tool.id}
          empty="This server has not listed any tools."
          columns={[
            {
              key: 'tool',
              header: 'Tool',
              emphasis: 'primary',
              cell: (tool) => <ToolCell tool={tool} />,
            },
            {
              key: 'review',
              header: 'Your review',
              cell: (tool) =>
                mayManage ? (
                  <ToolReviewForm organizationId={organizationId} tool={tool} />
                ) : (
                  <Badge>{tool.enabled ? 'Enabled' : 'Not enabled'}</Badge>
                ),
            },
            {
              key: 'access',
              header: 'Who can use it',
              cell: (tool) => {
                const given = grants.filter((grant) => grant.mcpToolId === tool.id);
                return (
                  <div className="flex flex-col items-start gap-1">
                    {given.map((grant) => (
                      <span key={grant.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone="success">{agentName.get(grant.agentId) ?? 'An agent'}</Badge>
                        {mayManage ? (
                          <RevokeGrantForm
                            organizationId={organizationId}
                            grantId={grant.id}
                            agentName={agentName.get(grant.agentId) ?? 'agent'}
                          />
                        ) : null}
                      </span>
                    ))}
                    {mayManage && tool.enabled && server.enabled ? (
                      <GrantForm
                        organizationId={organizationId}
                        agents={agents.filter((agent) => !given.some((grant) => grant.agentId === agent.id))}
                        target={{ mcpToolId: tool.id }}
                        alwaysAsks
                        everyAgentHasIt={agents.length > 0 && agents.every((agent) => given.some((grant) => grant.agentId === agent.id))}
                      />
                    ) : given.length === 0 ? (
                      <Hint>{tool.enabled ? 'The server is switched off.' : 'Enable the tool first.'}</Hint>
                    ) : null}
                  </div>
                );
              },
            },
          ]}
        />
      </div>
      {removed.length > 0 ? (
        <Hint className="mt-2">
          {removed.length} tool{removed.length === 1 ? ' was' : 's were'} listed before and {removed.length === 1 ? 'is' : 'are'} no longer offered:{' '}
          {removed.map((tool) => tool.name).join(', ')}. Access to {removed.length === 1 ? 'it' : 'them'} has stopped.
        </Hint>
      ) : null}
    </Section>
  );
}

function ToolCell({ tool }: { tool: McpTool }): ReactNode {
  return (
    <div className="min-w-0">
      <p className="break-words font-medium">{tool.name}</p>
      {tool.description ? <p className="line-clamp-2 break-words text-sm text-muted">{tool.description}</p> : null}
      <p className="text-xs text-subtle">
        Written by the server.{' '}
        {tool.reportedReadOnly === true
          ? 'It says it only reads. That is its claim, so it still needs your review.'
          : tool.reportedReadOnly === false
            ? 'It says it can change things.'
            : 'It does not say whether it changes things.'}
      </p>
    </div>
  );
}
