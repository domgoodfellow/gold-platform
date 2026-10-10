import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { listConnections } from '@/lib/domain/integrations/connections';
import {
  BROWSE_FILTERS,
  browseFilterFrom,
  connectorAvailability,
  connectorCategories,
  connectorLogoUrl,
  connectorsForFilter,
  filterConnectors,
  listConnectors,
  type BrowseFilter,
} from '@/lib/domain/integrations/connectors';
import { loadConnectorReadiness } from '@/lib/domain/integrations/readiness';
import { isSourceControlConnector } from '@/lib/adapters/source-control';
import { listResources } from '@/lib/domain/integrations/resources';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';
import { ConnectorCatalogue } from '@/features/integrations/catalogue/connector-catalogue';
import { ConnectedApps } from '@/features/integrations/connections/connected-apps';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function ConnectionsPage({
  organizationId,
  view,
  query,
  context,
}: {
  organizationId: string;
  view: 'connected' | 'browse';
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

  // Only a connector the catalogue has promoted is worth asking the API about; a planned one is
  // upcoming whatever the deployment holds.
  const readiness = await loadConnectorReadiness(
    db,
    connectors.filter((connector) => connector.status !== 'planned').map((connector) => connector.key),
  );
  const connectable = connectors.filter((connector) => connectorAvailability(connector, readiness.get(connector.key)) === 'connectable');

  const filter = browseFilterFrom(first(query.filter));
  const counts = Object.fromEntries(
    BROWSE_FILTERS.map((name) => [name, connectorsForFilter(connectors, { filter: name, readiness, connectedKeys }).length]),
  ) as Record<BrowseFilter, number>;
  const inFilter = connectorsForFilter(connectors, { filter, readiness, connectedKeys });
  // A category pill exists only if the set on screen has something under it.
  const categories = connectorCategories(inFilter);
  const shown = filterConnectors(inFilter, { query: q, category });
  const browseHref = (next: { filter?: BrowseFilter; q?: string; category?: string }) => {
    const params = new URLSearchParams();
    if (next.filter && next.filter !== 'available') params.set('filter', next.filter);
    if (next.q) params.set('q', next.q);
    if (next.category) params.set('category', next.category);
    const suffix = params.size ? `?${params}` : '';
    return `/organizations/${organizationId}/settings/connections/apps${suffix}`;
  };

  return (
    <SettingsPageFrame>
      <PageHeader
        title={view === 'connected' ? 'Connections' : 'Browse apps'}
        crumbs={view === 'connected'
          ? [{ label: 'Settings', href: settingsLandingHref(organizationId) }]
          : [
              { label: 'Settings', href: settingsLandingHref(organizationId) },
              { label: 'Connections', href: settingsScopeHref('connections', organizationId) },
            ]}
      />
      <IntegrationsNav organizationId={organizationId} current={view} />
      {oauthError ? (
        <Hint className="mt-4 block" role="alert">
          {oauthError}
        </Hint>
      ) : null}

      {view === 'connected' ? (
        <ConnectedApps
          organizationId={organizationId}
          active={active}
          connectorByKey={connectorByKey}
          logoUrlByKey={logoUrlByKey}
          resourceCount={importableResources}
          importCount={runs.length}
          needsAttentionCount={needsAttention.length}
          mayManage={mayManage}
          browseHref={browseHref({})}
          connectable={connectable}
          organizationName={organization.name}
          mcpServerCount={mcpServerCount}
        />
      ) : (
        <ConnectorCatalogue
          organizationId={organizationId}
          connectors={shown}
          logoUrlByKey={logoUrlByKey}
          connectedKeys={connectedKeys}
          mayManage={mayManage}
          filter={filter}
          counts={counts}
          categories={categories}
          query={q}
          category={category}
          hrefFor={browseHref}
        />
      )}
    </SettingsPageFrame>
  );
}
