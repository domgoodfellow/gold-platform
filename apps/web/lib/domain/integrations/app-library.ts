import metadata from '@/lib/contracts/integrations/library.generated.json';
import type { Connector } from './connectors';
import type { ConnectorReadiness } from './readiness';

export const APP_CATEGORIES = ['CRM & Sales', 'Accounting & Finance', 'Payments', 'Banking & Financial Data', 'Commerce',
  'Marketing & Advertising', 'Communications', 'Customer Support', 'Field Service & Logistics', 'Scheduling & Calendars',
  'Files & Cloud Storage', 'Documents & Productivity', 'Developer Tools', 'Website & Content Management', 'Analytics & Data',
  'AI & Agents', 'Automation', 'Human Resources', 'Project Management'] as const;
export const APP_WORKSPACES = ['crm','communications','marketing','support','finance','field','studio','ai','automations','library'] as const;
export type LibraryAction = { key:string; capability:string; name:string; description:string; executable:boolean;
  inputs:{properties:Record<string,{type:string;description?:string;default?:unknown}>;required:string[]} };
export type LibraryApplication = { key:string;connector_key:string;name:string;description:string;icon:string;category:string;workspace:string;
  auth:{type:string};actions:LibraryAction[] };
export const importedApplications = metadata.applications as LibraryApplication[];
export type LibraryEntry = { key: string; name: string; description: string; icon: string | null; applications: LibraryApplication[];
  categories: string[]; workspaces: string[]; authMethod: string; canConnect: boolean; blocker: string | null; actionCount: number };

export function buildAppLibrary(connectors: Connector[], readiness: Map<string, ConnectorReadiness>): LibraryEntry[] {
  const entries = new Map<string, LibraryEntry>();
  for (const app of importedApplications) {
    let entry = entries.get(app.connector_key);
    if (!entry) {
      const native = connectors.find(c => c.key === app.connector_key);
      const ready = readiness.get(app.connector_key);
      const canConnect = !!ready?.configured && !!ready?.implemented;
      entry = { key: app.connector_key, name: native?.name ?? app.name, description: native?.description ?? app.description,
        icon: app.icon, applications: [], categories: [], workspaces: [], authMethod: native?.authMethod ?? app.auth.type,
        canConnect, blocker: canConnect ? null : !ready ? 'Connecting apps isn’t available right now.'
          : !ready.implemented ? 'Connecting this app isn’t available yet.'
          : 'Your administrator needs to set up this app before you can connect it.', actionCount: 0 };
      entries.set(entry.key, entry);
    }
    entry.applications.push(app);
    if (!entry.categories.includes(app.category)) entry.categories.push(app.category);
    if (!entry.workspaces.includes(app.workspace)) entry.workspaces.push(app.workspace);
    entry.actionCount += app.actions.length;
  }
  for (const connector of connectors) {
    const ready = readiness.get(connector.key);
    if (entries.has(connector.key) || connector.connectionMethod === 'mcp' || !ready?.implemented) continue;
    entries.set(connector.key, { key: connector.key, name: connector.name, description: connector.description, icon: null,
      applications: [], categories: [connector.category], workspaces: [], authMethod: connector.authMethod,
      canConnect: ready.configured, blocker: ready.configured ? null : 'Your administrator needs to set up this app.', actionCount: 0 });
  }
  return [...entries.values()].sort((a,b) => a.name.localeCompare(b.name));
}

export function filterAppLibrary(entries: LibraryEntry[], input: { q?: string; category?: string; workspace?: string; connectedOnly?: boolean; connectedKeys?: Set<string> }) {
  const needle = input.q?.trim().toLowerCase() ?? '';
  return entries.filter(entry => (!input.connectedOnly || input.connectedKeys?.has(entry.key)) &&
    (!input.category || entry.categories.includes(input.category)) && (!input.workspace || entry.workspaces.includes(input.workspace)) &&
    (!needle || [entry.name, entry.description,...entry.applications.map(a=>a.name)].join(' ').toLowerCase().includes(needle)));
}
export function libraryApplication(key: string) { return importedApplications.find(a => a.key === key); }
export const importedApplicationCount = metadata.applications.length;
