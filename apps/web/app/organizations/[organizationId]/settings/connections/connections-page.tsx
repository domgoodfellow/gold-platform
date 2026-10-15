import { Hint } from '@/components/controls/inputs';
import { listConnections } from '@/lib/domain/integrations/connections';
import {
  connectorAvailability,
  connectorLogoUrl,
  listConnectors,
} from '@/lib/domain/integrations/connectors';
import { loadConnectorReadiness } from '@/lib/domain/integrations/readiness';
import { isSourceControlConnector } from '@/lib/adapters/source-control';
import { listResources } from '@/lib/domain/integrations/resources';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { ConnectedApps } from '@/features/integrations/connections/connected-apps';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { AppLibrary } from '@/features/integrations/catalogue/app-library';
import { buildAppLibrary, filterAppLibrary } from '@/lib/domain/integrations/app-library';

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function ConnectionsPage({
  organizationId,
  query,
  context,
}: {
  organizationId: string;
  query: Record<string, string | string[] | undefined>;
  context: Awaited<ReturnType<typeof requireOrganization>>;
}) {
  const q = first(query.q)?.trim() ?? '';
  const category = first(query.category) ?? '';
  const oauthError = first(query.oauth_error);
  const { db, organization } = context;

  const [allConnections, resources, runs, everyConnector] = await Promise.all([
    listConnections(db, { organizationId }),
    listResources(db, { organizationId }),
    listImportRuns(db, { organizationId }),
    listConnectors(db),
  ]);
  // An MCP server has its own view (its tools are reviewed and granted one by one) and is never
  // offered through Browse, whose Connect starts a vendor sign-in.
  const connectors = everyConnector.filter((connector) => connector.connectionMethod !== 'mcp');
  const mcpKeys = new Set(everyConnector.filter((connector) => connector.connectionMethod === 'mcp').map((connector) => connector.key));
  const connections = allConnections.filter((connection) => !mcpKeys.has(connection.connectorKey));
  const mcpServerCount = allConnections.filter((connection) => mcpKeys.has(connection.connectorKey) && connection.status !== 'disconnected').length;

  const mayManage = organization.capabilities.includes('integration.manage');
  // A repository is something GildOps may read, not a source a business imports customers from, so it is not a "data source".
  const sourceControlConnections = new Set(connections.filter((c) => isSourceControlConnector(c.connectorKey)).map((c) => c.id));
  const importableResources = resources.filter((r) => !(r.connectionId && sourceControlConnections.has(r.connectionId))).length;
  const active = connections.filter((connection) => connection.status !== 'disconnected');
  const needsAttention = connections.filter((connection) => connection.status === 'needs_attention');
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  const connectedKeys = new Set(active.map((connection) => connection.connectorKey));
  const logoUrlByKey = new Map(connectors.map((connector) => [connector.key, connector.iconRef ? connectorLogoUrl(db, connector.iconRef) : null]));

  // Deployment readiness is independent of catalogue discovery.
  const readiness = await loadConnectorReadiness(
    db,
    connectors.map((connector) => connector.key),
  );
  const connectable = connectors.filter((connector) => connectorAvailability(connector, readiness.get(connector.key)) === 'connectable');

  const catalogOpen = first(query.catalog) === 'open';
  const workspace = first(query.workspace) ?? '';
  const page = Math.max(0, Math.min(100, Number(first(query.page)) || 0));
  const library = catalogOpen ? filterAppLibrary(buildAppLibrary(connectors,readiness), { q, category, workspace,
    connectedOnly:first(query.filter)==='connected',connectedKeys }) : [];
  const accounts = new Map<string,{id:string;label:string}[]>();
  for (const connection of active) accounts.set(connection.connectorKey,[...(accounts.get(connection.connectorKey)??[]),
    {id:connection.id,label:connection.accountLabel??'Connected account'}]);
  const connectionsHref = `/organizations/${organizationId}/settings/connections`;

  return (
    <SettingsPageFrame width="fluid">
      <SettingsPageHeader title="Connections" />
      <IntegrationsNav organizationId={organizationId} current="connected" />
      {oauthError ? (
        <Hint className="mt-4 block" role="alert">
          {oauthError}
        </Hint>
      ) : null}

      <ConnectedApps
          organizationId={organizationId}
          active={active}
          connectorByKey={connectorByKey}
          logoUrlByKey={logoUrlByKey}
          resourceCount={importableResources}
          importCount={runs.length}
          needsAttentionCount={needsAttention.length}
          mayManage={mayManage}
          catalogOpen={catalogOpen}
          catalogHref={catalogOpen ? connectionsHref : `${connectionsHref}?catalog=open#app-library`}
          connectable={connectable}
          organizationName={organization.name}
          mcpServerCount={mcpServerCount}
        />
      {catalogOpen ? (
        <AppLibrary organizationId={organizationId} entries={library.slice(page*24,(page+1)*24)} connected={accounts}
          mayManage={mayManage} q={q} category={category} workspace={workspace} connectedOnly={first(query.filter)==='connected'} page={page} total={library.length} />
      ) : null}
    </SettingsPageFrame>
  );
}
