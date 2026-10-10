import { EmptyState } from '@/components/surfaces/section';
import { PageHeader } from '@/components/headers/page-header';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { McpOverview } from '@/features/integrations/mcp/mcp-overview';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listMcpServers } from '@/lib/domain/integrations/mcp';
import { loadConnectorReadiness } from '@/lib/domain/integrations/readiness';
import { listActiveGrants, listExecutions, listGrantableAgents } from '@/lib/domain/integrations/tool-access';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

export const dynamic = 'force-dynamic';

/** MCP servers: connect one, review what it offers, give an agent access, and see what has happened. */
export default async function McpServersPage({ params }: PageProps<'/organizations/[organizationId]/settings/connections/mcp'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('integration.manage');

  const readiness = await loadConnectorReadiness(db, ['mcp_server']);
  const available = readiness.get('mcp_server');
  const operational = Boolean(available?.implemented && available.configured);

  const [servers, connections, grants, agents, executions] = mayManage
    ? await Promise.all([
        listMcpServers(db, { organizationId }),
        listConnections(db, { organizationId }),
        listActiveGrants(db, { organizationId }),
        listGrantableAgents(db, { organizationId }),
        listExecutions(db, { organizationId }),
      ])
    : [[], [], [], [], []];

  return (
    <SettingsPageFrame>
      <PageHeader
        title="MCP servers"
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Connections', href: settingsScopeHref('connections', organizationId) },
        ]}
      />
      <IntegrationsNav organizationId={organizationId} current="mcp" />
      {!mayManage ? (
        <EmptyState
          className="mt-6"
          title="Only people who manage integrations can see this"
          description="Ask someone with access to integrations if you need a server added or reviewed."
        />
      ) : !operational && servers.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="Custom MCP servers are not available here yet"
          description="This deployment has not been set up to let a business connect a server of its own. It can be turned on without changing anything you already have."
        />
      ) : (
        <McpOverview
          organizationId={organizationId}
          servers={servers}
          connections={connections}
          grants={grants}
          agents={agents}
          executions={executions}
          mayManage={operational && mayManage}
        />
      )}
    </SettingsPageFrame>
  );
}
