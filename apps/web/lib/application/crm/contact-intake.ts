import type { Db } from '@/lib/db/types';
import { listResources } from '@/lib/domain/integrations/resources';
import { listConnections } from '@/lib/domain/integrations/connections';
import { libraryHref, libraryNewImportHref, librarySourceHref } from '@/lib/route/library';

/** Worksheet resources are the only verified synchronized contact sources (Library reconciliation). */
const WORKSHEETS = ['google_sheet', 'microsoft_workbook'] as const;

export type IntakeChoice =
  | { state: 'available'; href?: string; note?: string }
  | { state: 'unavailable'; reason: string };
export type SyncSource = { id: string; name: string; type: string; href: string; connection: string };
export type ContactIntakeOptions = {
  manual: IntakeChoice;
  import: IntakeChoice;
  sync: IntakeChoice & { sources: SyncSource[]; connectHref?: string };
};

/**
 * Which of the three ways into Contacts this member may take, evaluated separately and from the
 * same checks the destinations enforce: manual creation needs `customer.create`; Library imports
 * need `integration.manage`, and applying one needs `customer.create` for new rows and
 * `customer.update` for updates (checked per row by the database); synchronized worksheets need `integration.manage`, and connecting a new
 * provider account is Connections' own door, entitled by the Integrations module. Nothing here
 * grants access; it only avoids offering a path that would be refused.
 */
export async function contactIntakeOptions(db: Db, input: {
  organizationId: string; capabilities: readonly string[]; modules: ReadonlySet<string>;
}): Promise<ContactIntakeOptions> {
  const { organizationId } = input; const has = (capability: string) => input.capabilities.includes(capability);
  const mayCreate = has('customer.create'); const mayIntegrate = has('integration.manage');
  const manual: IntakeChoice = mayCreate ? { state: 'available' } : { state: 'unavailable', reason: 'Your role cannot add contacts.' };
  // Applying an import writes contacts: new rows need `customer.create`, updates need `customer.update`
  // (both checked per row by apply_import_run). With neither, every write would be refused.
  const mayUpdate = has('customer.update');
  const importChoice: IntakeChoice = !mayIntegrate
    ? { state: 'unavailable', reason: 'Importing needs permission to manage data sources.' }
    : !mayCreate && !mayUpdate ? { state: 'unavailable', reason: 'Importing writes contacts, which your role cannot add or change.' }
    : { state: 'available', href: libraryNewImportHref(organizationId),
      note: !mayCreate ? 'Your role can update existing contacts from a file but cannot add new ones.' : !mayUpdate ? 'Your role can add new contacts from a file but cannot update existing ones.' : undefined };
  if (!mayIntegrate) return { manual, import: importChoice, sync: { state: 'unavailable', reason: 'Synchronizing needs permission to manage data sources.', sources: [] } };

  const [resources, connections] = await Promise.all([listResources(db, { organizationId }), listConnections(db, { organizationId })]);
  const status = new Map(connections.map(connection => [connection.id, connection.status]));
  const sources = resources
    .filter(resource => resource.status === 'active' && (WORKSHEETS as readonly string[]).includes(resource.resourceType))
    .map(resource => ({ id: resource.id, name: resource.displayName, type: resource.resourceType === 'google_sheet' ? 'Google Sheets worksheet' : 'Microsoft Excel workbook',
      href: librarySourceHref(organizationId, resource.id), connection: resource.connectionId ? status.get(resource.connectionId) ?? 'unavailable' : 'snapshot' }));
  const connectHref = input.modules.has('integrations') ? `/organizations/${organizationId}/settings/connections` : undefined;
  const sync = sources.length || connectHref
    ? { state: 'available' as const, href: libraryHref(organizationId, 'sources'), sources, connectHref }
    : { state: 'unavailable' as const, reason: 'No worksheet is connected, and connecting one needs the Integrations module.', sources };
  return { manual, import: importChoice, sync };
}

/** Whether any intake path is open, so an entry point is shown only when it leads somewhere. */
export function anyIntake(options: ContactIntakeOptions): boolean {
  return [options.manual, options.import, options.sync].some(choice => choice.state === 'available');
}
