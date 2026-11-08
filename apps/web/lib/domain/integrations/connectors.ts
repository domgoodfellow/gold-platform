import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import type { ConnectorReadiness } from './readiness';

/**
 * The connector catalogue — which outside apps exist, never which a business has
 * connected (`connections.ts`) and never who GOLD buys infrastructure from (`providers/`).
 * Visibility is the table's own policy: a business sees public rows, platform staff sees all.
 */

export const CONNECTOR_STATUSES = ['planned', 'beta', 'live'] as const;
export const CONNECTOR_AUTH_METHODS = ['none', 'oauth2', 'api_key'] as const;
export const CONNECTOR_CONNECTION_METHODS = ['native', 'mcp', 'automation', 'custom'] as const;
export const CONNECTOR_CAPABILITIES = [
  'app_connections',
  'file_imports',
  'data_mapping',
  'scheduled_sync',
  'triggers_actions',
  'agent_tools',
] as const;

export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];
export type ConnectorAuthMethod = (typeof CONNECTOR_AUTH_METHODS)[number];
export type ConnectorConnectionMethod = (typeof CONNECTOR_CONNECTION_METHODS)[number];
export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number];

export type ConnectorAppFeature = { featureId: string; featureKey: string; featureLabel: string };

export type ConnectorApp = {
  id: string;
  key: string;
  name: string;
  description: string;
  displayOrder: number;
  /** What GOLD runs for this one app — never inherited from the parent connector (section 11). */
  implementationState: 'planned' | 'partial' | 'available';
  vendorStatus: 'generally_available' | 'preview' | 'restricted' | 'legacy' | null;
  docsUrl: string | null;
  /** GOLD Features this app can support — descriptive, never an entitlement grant (section 4). */
  features: ConnectorAppFeature[];
};

export type Connector = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  suite: string | null;
  status: ConnectorStatus;
  authMethod: ConnectorAuthMethod;
  connectionMethod: ConnectorConnectionMethod;
  isPublic: boolean;
  displayOrder: number;
  iconRef: string | null;
  marketingSlug: string | null;
  marketingSummary: string;
  marketingDescription: string;
  capabilities: ConnectorCapability[];
  apps: ConnectorApp[];
};

export type ConnectorInput = Omit<Connector, 'id' | 'apps'>;

const COLUMNS = `
  id, key, name, description, category, suite, status, auth_method, connection_method, is_public,
  display_order, icon_ref, marketing_slug, marketing_summary, marketing_description, capabilities,
  platform_connector_apps (
    id, key, name, description, display_order, implementation_state, vendor_status, docs_url,
    platform_connector_app_features ( feature_id, platform_catalog_features ( id, key, label ) )
  )
`;

type Row = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  suite: string | null;
  status: string;
  auth_method: string;
  connection_method: string;
  is_public: boolean;
  display_order: number;
  icon_ref: string | null;
  marketing_slug: string | null;
  marketing_summary: string;
  marketing_description: string;
  capabilities: string[];
  platform_connector_apps:
    | {
        id: string;
        key: string;
        name: string;
        description: string;
        display_order: number;
        implementation_state: string;
        vendor_status: string | null;
        docs_url: string | null;
        platform_connector_app_features:
          | { feature_id: string; platform_catalog_features: { id: string; key: string; label: string } | null }[]
          | null;
      }[]
    | null;
};

function fromRow(row: Row): Connector {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    suite: row.suite,
    status: row.status as ConnectorStatus,
    authMethod: row.auth_method as ConnectorAuthMethod,
    connectionMethod: row.connection_method as ConnectorConnectionMethod,
    isPublic: row.is_public,
    displayOrder: row.display_order,
    iconRef: row.icon_ref,
    marketingSlug: row.marketing_slug,
    marketingSummary: row.marketing_summary,
    marketingDescription: row.marketing_description,
    capabilities: row.capabilities as ConnectorCapability[],
    apps: (row.platform_connector_apps ?? [])
      .map((app) => ({
        id: app.id,
        key: app.key,
        name: app.name,
        description: app.description,
        displayOrder: app.display_order,
        implementationState: app.implementation_state as ConnectorApp['implementationState'],
        vendorStatus: app.vendor_status as ConnectorApp['vendorStatus'],
        docsUrl: app.docs_url,
        features: (app.platform_connector_app_features ?? [])
          .filter((entry): entry is typeof entry & { platform_catalog_features: NonNullable<typeof entry.platform_catalog_features> } =>
            entry.platform_catalog_features !== null,
          )
          .map((entry) => ({
            featureId: entry.platform_catalog_features.id,
            featureKey: entry.platform_catalog_features.key,
            featureLabel: entry.platform_catalog_features.label,
          })),
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
  };
}

export async function listConnectors(db: Db): Promise<Connector[]> {
  const { data, error } = await db
    .from('platform_connectors')
    .select(COLUMNS)
    .order('display_order')
    .order('name');
  if (error) throw fromDatabaseError(error, 'integrations.connectors_list_failed');
  return (data as unknown as Row[]).map(fromRow);
}

export async function getConnector(db: Db, key: string): Promise<Connector | null> {
  const { data, error } = await db.from('platform_connectors').select(COLUMNS).eq('key', key).maybeSingle();
  if (error) throw fromDatabaseError(error, 'integrations.connector_get_failed');
  return data ? fromRow(data as unknown as Row) : null;
}

/**
 * What a business is told about an app it has not connected. Three independent facts decide it —
 * the catalogue's product status, whether this deployment holds an adapter, and whether it holds the
 * vendor's registration — so `planned` never doubles for *someone forgot to configure the client*.
 *
 * - `connectable`: not planned, and the API says it implements and is configured for it.
 * - `upcoming`: planned. A roadmap fact; no control is drawn for it.
 * - `unavailable`: promised by the catalogue but not operable here. Not offered to a business at
 *   all; platform staff sees why on the connector's own page.
 */
export type ConnectorAvailability = 'connectable' | 'upcoming' | 'unavailable';

export function connectorAvailability(
  connector: Pick<Connector, 'status'>,
  readiness: Pick<ConnectorReadiness, 'implemented' | 'configured'> | undefined,
): ConnectorAvailability {
  if (connector.status === 'planned') return 'upcoming';
  return readiness?.implemented && readiness.configured ? 'connectable' : 'unavailable';
}

/**
 * The operator's reading of the same three facts, which a business is never shown: *why* an app is
 * or is not offered. `unknown` is the API not answering, said plainly rather than guessed at.
 */
export type ConnectorOperationalState = 'upcoming' | 'adapter_missing' | 'needs_setup' | 'operational' | 'unknown';

export function connectorOperationalState(
  connector: Pick<Connector, 'status'>,
  readiness: Pick<ConnectorReadiness, 'implemented' | 'configured'> | undefined,
): ConnectorOperationalState {
  if (connector.status === 'planned') return 'upcoming';
  if (!readiness) return 'unknown';
  if (!readiness.implemented) return 'adapter_missing';
  return readiness.configured ? 'operational' : 'needs_setup';
}

/** Whether a business can press Connect: never true for a deployment known not to honour it. */
export function isConnectable(
  connector: Pick<Connector, 'status'>,
  readiness: Pick<ConnectorReadiness, 'implemented' | 'configured'> | undefined,
): boolean {
  return connectorAvailability(connector, readiness) === 'connectable';
}

/**
 * Whether connecting means a vendor's own sign-in (handled by `apps/api`) rather than a direct
 * record. The catalogue says how a connector authorizes; nothing here names a connector.
 */
export function usesSignIn(connector: Pick<Connector, 'authMethod'>): boolean {
  return connector.authMethod === 'oauth2';
}

/** The one view of the catalogue Browse shows by default and its two siblings. */
export const BROWSE_FILTERS = ['available', 'connected', 'upcoming'] as const;
export type BrowseFilter = (typeof BROWSE_FILTERS)[number];

export function browseFilterFrom(value: string | undefined): BrowseFilter {
  return (BROWSE_FILTERS as readonly string[]).includes(value ?? '') ? (value as BrowseFilter) : 'available';
}

/**
 * What each Browse filter holds. `available` is only what can be connected right now and is not yet
 * connected; `connected` is what this business already has; `upcoming` is the roadmap. A connector
 * that is unavailable on this deployment appears under none of them.
 */
export function connectorsForFilter<T extends Pick<Connector, 'key' | 'status'>>(
  connectors: readonly T[],
  input: { filter: BrowseFilter; readiness: ReadonlyMap<string, ConnectorReadiness>; connectedKeys: ReadonlySet<string> },
): T[] {
  return connectors.filter((connector) => {
    const availability = connectorAvailability(connector, input.readiness.get(connector.key));
    if (input.filter === 'upcoming') return availability === 'upcoming';
    if (input.filter === 'connected') return availability !== 'upcoming' && input.connectedKeys.has(connector.key);
    return availability === 'connectable' && !input.connectedKeys.has(connector.key);
  });
}

function oneOf<T extends string>(value: string, allowed: readonly T[], message: string): T {
  if (!allowed.includes(value as T)) throw new DomainError(message, 'integrations.connector_invalid');
  return value as T;
}

/** Validate here so a person gets a sentence; the table's CHECKs remain the guarantee. */
export function validateConnectorInput(input: ConnectorInput): ConnectorInput {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(input.key)) {
    throw new DomainError('A key is lowercase letters, digits and underscores, starting with a letter.', 'integrations.connector_invalid');
  }
  if (input.name.trim() === '') throw new DomainError('Give the connector a name.', 'integrations.connector_invalid');
  if (input.category.trim() === '') throw new DomainError('Give the connector a category.', 'integrations.connector_invalid');
  if (input.marketingSlug && !/^[a-z][a-z0-9-]{0,60}$/.test(input.marketingSlug)) {
    throw new DomainError('A public address is lowercase letters, digits and hyphens.', 'integrations.connector_invalid');
  }
  if (input.marketingSummary.length > 200) {
    throw new DomainError('The public summary is longer than 200 characters.', 'integrations.connector_invalid');
  }
  return {
    ...input,
    status: oneOf(input.status, CONNECTOR_STATUSES, 'Choose planned, beta or live.'),
    authMethod: oneOf(input.authMethod, CONNECTOR_AUTH_METHODS, 'Choose how it authorizes.'),
    connectionMethod: oneOf(input.connectionMethod, CONNECTOR_CONNECTION_METHODS, 'Choose how it connects.'),
    capabilities: input.capabilities.map((c) => oneOf(c, CONNECTOR_CAPABILITIES, `Unknown action ${c}.`)),
  };
}

function forbidden(error: { code?: string; message: string }, code: string): DomainError {
  if (error.code === '42501') return new DomainError('Only platform staff can edit the connector catalogue.', 'integrations.forbidden');
  return fromDatabaseError(error, code);
}

export async function upsertConnector(db: Db, input: ConnectorInput): Promise<string> {
  const v = validateConnectorInput(input);
  const { data, error } = await db.rpc('upsert_platform_connector', {
    p_key: v.key,
    p_name: v.name,
    p_description: v.description,
    p_category: v.category,
    p_suite: v.suite ?? '',
    p_status: v.status,
    p_auth_method: v.authMethod,
    p_connection_method: v.connectionMethod,
    p_is_public: v.isPublic,
    p_display_order: v.displayOrder,
    p_icon_ref: v.iconRef ?? '',
    p_marketing_slug: v.marketingSlug ?? '',
    p_marketing_summary: v.marketingSummary,
    p_marketing_description: v.marketingDescription,
    p_capabilities: v.capabilities,
  });
  if (error) {
    if (error.code === '23505') throw new DomainError('That public address is already used by another connector.', 'integrations.connector_invalid');
    throw forbidden(error, 'integrations.connector_write_failed');
  }
  return data;
}

export async function setConnectorApp(
  db: Db,
  input: {
    connectorKey: string;
    key: string;
    name: string;
    description: string;
    displayOrder: number;
    implementationState?: ConnectorApp['implementationState'];
    vendorStatus?: ConnectorApp['vendorStatus'];
    docsUrl?: string | null;
  },
): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(input.key) || input.name.trim() === '') {
    throw new DomainError('An app needs a key (lowercase) and a name.', 'integrations.connector_invalid');
  }
  const { error } = await db.rpc('set_platform_connector_app', {
    p_connector_key: input.connectorKey,
    p_key: input.key,
    p_name: input.name,
    p_description: input.description,
    p_display_order: input.displayOrder,
    p_implementation_state: input.implementationState ?? 'planned',
    p_vendor_status: input.vendorStatus ?? undefined,
    p_docs_url: input.docsUrl ?? undefined,
  });
  if (error) throw forbidden(error, 'integrations.connector_write_failed');
}

export async function removeConnectorApp(db: Db, input: { connectorKey: string; key: string }): Promise<void> {
  const { error } = await db.rpc('remove_platform_connector_app', { p_connector_key: input.connectorKey, p_key: input.key });
  if (error) throw forbidden(error, 'integrations.connector_write_failed');
}

/** Which GOLD Features a connector app can support — a description, never an entitlement grant (section 4). */
export async function setConnectorAppFeature(db: Db, input: { connectorAppId: string; featureId: string; note?: string }): Promise<void> {
  const { error } = await db.rpc('set_connector_app_feature', {
    p_connector_app_id: input.connectorAppId,
    p_feature_id: input.featureId,
    p_relationship: 'supports',
    p_note: input.note ?? '',
  });
  if (error) throw forbidden(error, 'integrations.connector_write_failed');
}

export async function removeConnectorAppFeature(db: Db, input: { connectorAppId: string; featureId: string }): Promise<void> {
  const { error } = await db.rpc('remove_connector_app_feature', {
    p_connector_app_id: input.connectorAppId,
    p_feature_id: input.featureId,
  });
  if (error) throw forbidden(error, 'integrations.connector_write_failed');
}

const LOGO_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];

/** Upload a logo and point the connector at it; the bytes it replaces are removed afterwards. */
export async function uploadConnectorLogo(db: Db, input: { key: string; file: File }): Promise<void> {
  if (!LOGO_TYPES.includes(input.file.type)) {
    throw new DomainError('A logo is a PNG, SVG, JPEG or WebP image.', 'integrations.logo_invalid');
  }
  if (input.file.size > 1_048_576) throw new DomainError('A logo is at most 1 MB.', 'integrations.logo_invalid');

  const connector = await getConnector(db, input.key);
  if (!connector) throw new DomainError('No such connector.', 'integrations.connector_get_failed');

  const path = `${input.key}/${crypto.randomUUID()}`;
  const upload = await db.storage.from('connector-logos').upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (upload.error) throw fromDatabaseError(upload.error, 'integrations.logo_upload_failed');

  try {
    await upsertConnector(db, { ...connector, iconRef: path });
  } catch (error) {
    await db.storage.from('connector-logos').remove([path]);
    throw error;
  }
  if (connector.iconRef) await db.storage.from('connector-logos').remove([connector.iconRef]);
}

/** Public, not signed — a logo is on a page a stranger opens. */
export function connectorLogoUrl(db: Db, iconRef: string): string {
  return db.storage.from('connector-logos').getPublicUrl(iconRef).data.publicUrl;
}

export type OrganizationConnection = {
  id: string;
  connectorKey: string;
  connectorName: string;
  accountLabel: string | null;
  status: string;
  scopes: string[];
  hasCredential: boolean;
  resourceCount: number;
  lastVerifiedAt: string | null;
  createdAt: string;
};

/** Platform staff's read of one business's connections: metadata and health, never a credential. */
export async function listOrganizationConnections(db: Db, input: { organizationId: string }): Promise<OrganizationConnection[]> {
  const { data, error } = await db.rpc('organization_integration_connections', { p_organization_id: input.organizationId });
  if (error) {
    if (error.code === '42501') throw new DomainError('Only platform staff can read this.', 'integrations.forbidden');
    throw fromDatabaseError(error, 'integrations.connections_list_failed');
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    connectorKey: row.connector_key,
    connectorName: row.connector_name,
    accountLabel: row.account_label,
    status: row.status,
    scopes: row.scopes ?? [],
    hasCredential: row.has_credential,
    resourceCount: Number(row.resource_count),
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
  }));
}

export type ConnectorUsage = { activeConnections: number; attentionConnections: number; organizations: number };

/** Platform staff's per-connector counts, keyed by connector key. Counts only — no account, no credential. */
export async function connectorUsage(db: Db): Promise<Map<string, ConnectorUsage>> {
  const { data, error } = await db.rpc('platform_connector_usage');
  if (error) {
    if (error.code === '42501') throw new DomainError('Only platform staff can read this.', 'integrations.forbidden');
    throw fromDatabaseError(error, 'integrations.usage_failed');
  }
  return new Map(
    (data ?? []).map((row) => [
      row.connector_key,
      {
        activeConnections: Number(row.active_connections),
        attentionConnections: Number(row.attention_connections),
        organizations: Number(row.organizations),
      },
    ]),
  );
}

/** The categories that exist, in the order the catalogue shows its connectors — never a list kept in a page. */
export function connectorCategories(connectors: readonly Pick<Connector, 'category'>[]): string[] {
  return [...new Set(connectors.map((connector) => connector.category))];
}

/** Search across what a person would type — name, suite, category, description — and narrow by one category. */
export function filterConnectors<T extends Pick<Connector, 'name' | 'suite' | 'category' | 'description'>>(
  connectors: readonly T[],
  input: { query?: string; category?: string },
): T[] {
  const needle = input.query?.trim().toLowerCase() ?? '';
  return connectors.filter((connector) => {
    if (input.category && connector.category !== input.category) return false;
    if (needle === '') return true;
    return [connector.name, connector.suite ?? '', connector.category, connector.description].some((field) =>
      field.toLowerCase().includes(needle),
    );
  });
}
