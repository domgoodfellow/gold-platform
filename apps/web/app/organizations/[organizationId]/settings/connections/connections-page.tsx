import { Hint } from '@/components/controls/inputs';
import { listConnections } from '@/lib/domain/integrations/connections';
import {
  connectorCategories,
  connectorLogoUrl,
  filterConnectors,
  listConnectors,
} from '@/lib/domain/integrations/connectors';
import { listResources } from '@/lib/domain/integrations/resources';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { ConnectorCatalogue } from '@/features/integrations/catalogue/connector-catalogue';
import { ConnectedApps } from '@/features/integrations/connections/connected-apps';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { SettingsScopeNav } from '@/features/settings/settings-scope-nav';
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

  const [connections, resources, runs, connectors] = await Promise.all([
    listConnections(db, { organizationId }),
    listResources(db, { organizationId }),
    listImportRuns(db, { organizationId }),
    listConnectors(db),
  ]);

  const mayManage = organization.capabilities.includes('integration.manage');
  const active = connections.filter((connection) => connection.status !== 'disconnected');
  const needsAttention = connections.filter((connection) => connection.status === 'needs_attention');
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  const connectedKeys = new Set(active.map((connection) => connection.connectorKey));
  const logoUrlByKey = new Map(connectors.map((connector) => [connector.key, connector.iconRef ? connectorLogoUrl(db, connector.iconRef) : null]));

  const categories = connectorCategories(connectors);
  const shown = filterConnectors(connectors, { query: q, category });
  const browseHref = (next: { q?: string; category?: string }) => {
    const params = new URLSearchParams();
    if (next.q) params.set('q', next.q);
    if (next.category) params.set('category', next.category);
    const suffix = params.size ? `?${params}` : '';
    return `/organizations/${organizationId}/settings/connections/apps${suffix}`;
  };

  return (
    <SettingsPageFrame>
      <SettingsScopeNav
        organizationId={organizationId}
        active="connections"
        title={view === 'connected' ? 'Connections' : 'Browse apps'}
        crumbs={view === 'connected'
          ? [{ label: 'Settings', href: `/organizations/${organizationId}/settings` }]
          : [
              { label: 'Settings', href: `/organizations/${organizationId}/settings` },
              { label: 'Connections', href: `/organizations/${organizationId}/settings/connections` },
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
          resourceCount={resources.length}
          importCount={runs.length}
          needsAttentionCount={needsAttention.length}
          mayManage={mayManage}
          browseHref={browseHref({})}
          connectors={connectors}
          organizationName={organization.name}
        />
      ) : (
        <ConnectorCatalogue
          organizationId={organizationId}
          connectors={shown}
          logoUrlByKey={logoUrlByKey}
          connectedKeys={connectedKeys}
          mayManage={mayManage}
          categories={categories}
          query={q}
          category={category}
          categoryHref={browseHref}
        />
      )}
    </SettingsPageFrame>
  );
}
