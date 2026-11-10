import type { Db } from '@/lib/db/types';
import type { ConfigGate } from '@/lib/navigation';
import { configTarget, configTargetOffered } from '@/lib/navigation';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listResources } from '@/lib/domain/integrations/resources';
import { connectorAvailability, listConnectors } from '@/lib/domain/integrations/connectors';
import { loadConnectorReadiness } from '@/lib/domain/integrations/readiness';
import { listLibraryFiles } from '@/lib/domain/documents/library-files';

export type ContactImportSources = {
  accounts: { id: string; label: string; connector: string; status: string }[];
  worksheets: { id: string; accountId: string; name: string; type: string }[];
  saved: { id: string; name: string }[];
  files: { id: string; name: string }[];
  providers: { key: string; name: string; connectable: boolean }[];
};

/** The source chooser projects canonical Library resources; it creates no import or credential. */
export async function loadContactImportSources(db: Db, organizationId: string, gate: ConfigGate): Promise<ContactImportSources> {
  const [connections, resources, files] = await Promise.all([
    listConnections(db, { organizationId }), listResources(db, { organizationId }),
    listLibraryFiles(db, { organizationId, filter: { search: '', family: 'spreadsheets', usage: 'any', sort: 'newest', page: 1 } }),
  ]);
  const providerKeys = ['google_workspace', 'microsoft_365'];
  const mayConnect = configTargetOffered(configTarget('integrations'), gate);
  const connectors = mayConnect ? (await listConnectors(db)).filter(connector => providerKeys.includes(connector.key)) : [];
  const readiness = mayConnect ? await loadConnectorReadiness(db, connectors.map(connector => connector.key)) : new Map();
  const accounts = connections.filter(connection => providerKeys.includes(connection.connectorKey)).map(connection => ({
    id: connection.id, label: connection.accountLabel ?? 'Account', connector: connection.connectorKey, status: connection.status,
  }));
  const accountIds = new Set(accounts.map(account => account.id));
  return {
    accounts,
    worksheets: resources.filter(resource => resource.status === 'active' && resource.connectionId && accountIds.has(resource.connectionId) && ['google_sheet', 'microsoft_workbook'].includes(resource.resourceType))
      .map(resource => ({ id: resource.id, accountId: resource.connectionId!, name: resource.displayName, type: resource.resourceType })),
    saved: resources.filter(resource => resource.status === 'active' && resource.resourceType === 'file_upload').map(resource => ({ id: resource.id, name: resource.displayName })),
    files: files.rows.filter(file => file.mimeType === 'text/csv' || file.fileName.toLowerCase().endsWith('.csv')).map(file => ({ id: file.id, name: file.fileName })),
    providers: connectors.map(connector => ({ key: connector.key, name: connector.name, connectable: connectorAvailability(connector, readiness.get(connector.key)) === 'connectable' })),
  };
}
