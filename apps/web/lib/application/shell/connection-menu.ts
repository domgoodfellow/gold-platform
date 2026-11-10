import type { Db } from '@/lib/db/types';
import { configTarget, configTargetOffered, type ConfigGate } from '@/lib/navigation';
import { settingsScopeHref } from '@/lib/route/settings';
import { listConnections } from '@/lib/domain/integrations/connections';
import { connectorAvailability, connectorLogoUrl, listConnectors, type Connector } from '@/lib/domain/integrations/connectors';
import { buildAppLibrary, importedApplications } from '@/lib/domain/integrations/app-library';
import { loadConnectorReadiness } from '@/lib/domain/integrations/readiness';
import type { HeaderConnectionAccount, HeaderConnections } from './connection-menu-model';

function reconnectHref(base: string, connector: Connector, connectionId: string): string | null {
  if (connector.connectionMethod === 'mcp') return null;
  const query = new URLSearchParams({ connection: connectionId });
  if (connector.authMethod === 'oauth2') return `${base}/connect/${connector.key}?${query}`;
  const application = importedApplications.find(app => app.connector_key === connector.key);
  return connector.authMethod === 'api_key' && application
    ? `${base}/apps/${application.key}?${query}`
    : null;
}

/** Metadata-only organization projection. Account credentials and platform providers never enter it. */
export async function loadHeaderConnections(db: Db, input: {
  organizationId: string;
  gate: ConfigGate;
  /** The shell does not wait for API readiness. Opening the control refreshes it separately. */
  includeReadiness?: boolean;
}): Promise<HeaderConnections | null> {
  if (!configTargetOffered(configTarget('integrations'), input.gate)) return null;
  const manageHref = settingsScopeHref('connections', input.organizationId);
  try {
    const [connections, connectors] = await Promise.all([
      listConnections(db, { organizationId: input.organizationId }), listConnectors(db),
    ]);
    const byKey = new Map(connectors.map(connector => [connector.key, connector]));
    const catalogue = new Map(buildAppLibrary(connectors, new Map()).map(entry => [entry.key, entry]));
    const readiness = input.includeReadiness
      ? await loadConnectorReadiness(db, [...new Set(connections.filter(connection => connection.status !== 'active').map(connection => connection.connectorKey))])
      : new Map();
    const accounts = connections.map(connection => {
      const connector = byKey.get(connection.connectorKey);
      const reconnect = connector && connection.status !== 'active' && connectorAvailability(connector, readiness.get(connector.key)) === 'connectable'
        ? reconnectHref(manageHref, connector, connection.id) : null;
      return {
        id: connection.id, connectorKey: connection.connectorKey,
        connectorName: connector?.name ?? 'Application unavailable',
        logoUrl: connector?.iconRef ? connectorLogoUrl(db, connector.iconRef) : null,
        accountLabel: connection.accountLabel ?? 'Account', status: connection.status,
        workspaces: catalogue.get(connection.connectorKey)?.workspaces ?? [],
        manageHref: connector?.connectionMethod === 'mcp' ? `${manageHref}/mcp` : `${manageHref}/${connection.id}`,
        reconnectHref: reconnect, reconnectsExternally: !!reconnect && connector?.authMethod === 'oauth2',
      } satisfies HeaderConnectionAccount;
    });
    return { state: 'ready', accounts, manageHref };
  } catch {
    return { state: 'unavailable', accounts: [], manageHref };
  }
}
