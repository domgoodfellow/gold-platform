import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * The provider-service catalogue — one capability a Provider exposes. `platform_providers`
 * (`accounts.ts`'s own nouns) says who GOLD buys infrastructure from; this says what, at a grain
 * fine enough to tell Gemini Interactions apart from Google Routes. Never a tenant Connector
 * (`lib/domain/integrations/connectors.ts`) — a Provider Service is infrastructure GOLD operates,
 * a Connector is an outside app a business authorizes.
 *
 * `implementationState` is what GOLD runs, the same vocabulary `platform_catalog_features` uses.
 * `vendorStatus` is the upstream service's own maturity and is independent of it — a service can
 * be a generally-available upstream API GOLD has never called, or a preview API GOLD already
 * depends on.
 */

export const PROVIDER_SERVICE_KINDS = ['runtime', 'data', 'infrastructure', 'distribution'] as const;
export const PROVIDER_SERVICE_IMPLEMENTATION_STATES = ['planned', 'partial', 'available'] as const;
export const PROVIDER_SERVICE_VENDOR_STATUSES = ['generally_available', 'preview', 'restricted', 'legacy'] as const;
export const PROVIDER_SERVICE_AUTH_MODES = ['none', 'api_key', 'oauth2', 'account_credential'] as const;

export type ProviderServiceKind = (typeof PROVIDER_SERVICE_KINDS)[number];
export type ProviderServiceImplementationState = (typeof PROVIDER_SERVICE_IMPLEMENTATION_STATES)[number];
export type ProviderServiceVendorStatus = (typeof PROVIDER_SERVICE_VENDOR_STATUSES)[number];
export type ProviderServiceAuthMode = (typeof PROVIDER_SERVICE_AUTH_MODES)[number];

export type FeatureMapping = {
  featureId: string;
  featureKey: string;
  featureLabel: string;
  moduleKey: string;
  productKey: string;
  relationship: 'supports';
  note: string;
};

export type ProviderService = {
  id: string;
  providerKey: string;
  key: string;
  label: string;
  description: string;
  family: string;
  kind: ProviderServiceKind;
  implementationState: ProviderServiceImplementationState;
  vendorStatus: ProviderServiceVendorStatus;
  authMode: ProviderServiceAuthMode;
  docsUrl: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
  features: FeatureMapping[];
};

export type ProviderServiceInput = Omit<ProviderService, 'id' | 'features'>;

const COLUMNS = `
  id, provider_key, key, label, description, family, kind, implementation_state, vendor_status,
  auth_mode, docs_url, display_order, metadata,
  platform_provider_service_features (
    relationship, note,
    platform_catalog_features (
      id, key, label,
      platform_catalog_modules ( key, platform_catalog_products ( key ) )
    )
  )
`;

type FeatureRow = {
  relationship: string;
  note: string;
  platform_catalog_features: {
    id: string;
    key: string;
    label: string;
    platform_catalog_modules: { key: string; platform_catalog_products: { key: string } | null } | null;
  } | null;
};

type Row = {
  id: string;
  provider_key: string;
  key: string;
  label: string;
  description: string;
  family: string;
  kind: string;
  implementation_state: string;
  vendor_status: string;
  auth_mode: string;
  docs_url: string | null;
  display_order: number;
  metadata: unknown;
  platform_provider_service_features: FeatureRow[] | null;
};

function fromRow(row: Row): ProviderService {
  return {
    id: row.id,
    providerKey: row.provider_key,
    key: row.key,
    label: row.label,
    description: row.description,
    family: row.family,
    kind: row.kind as ProviderServiceKind,
    implementationState: row.implementation_state as ProviderServiceImplementationState,
    vendorStatus: row.vendor_status as ProviderServiceVendorStatus,
    authMode: row.auth_mode as ProviderServiceAuthMode,
    docsUrl: row.docs_url,
    displayOrder: row.display_order,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    features: (row.platform_provider_service_features ?? [])
      .filter((entry): entry is FeatureRow & { platform_catalog_features: NonNullable<FeatureRow['platform_catalog_features']> } =>
        entry.platform_catalog_features !== null,
      )
      .map((entry) => ({
        featureId: entry.platform_catalog_features.id,
        featureKey: entry.platform_catalog_features.key,
        featureLabel: entry.platform_catalog_features.label,
        moduleKey: entry.platform_catalog_features.platform_catalog_modules?.key ?? '',
        productKey: entry.platform_catalog_features.platform_catalog_modules?.platform_catalog_products?.key ?? '',
        relationship: entry.relationship as 'supports',
        note: entry.note,
      })),
  };
}

export async function listProviderServices(db: Db): Promise<ProviderService[]> {
  const { data, error } = await db
    .from('platform_provider_services')
    .select(COLUMNS)
    .order('provider_key')
    .order('display_order');
  if (error) throw fromDatabaseError(error, 'providers.services_list_failed');
  return (data as unknown as Row[]).map(fromRow);
}

export async function listProviderServicesFor(db: Db, providerKey: string): Promise<ProviderService[]> {
  const { data, error } = await db
    .from('platform_provider_services')
    .select(COLUMNS)
    .eq('provider_key', providerKey)
    .order('display_order');
  if (error) throw fromDatabaseError(error, 'providers.services_list_failed');
  return (data as unknown as Row[]).map(fromRow);
}

function forbidden(error: { code?: string; message: string }, code: string): DomainError {
  if (error.code === '42501') return new DomainError('Only platform staff can edit the vendor services list.', 'providers.forbidden');
  if (error.code === '23503') return new DomainError('No such vendor, service or feature.', 'providers.not_found');
  return fromDatabaseError(error, code);
}

export async function upsertProviderService(db: Db, input: ProviderServiceInput): Promise<string> {
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(input.key)) {
    throw new DomainError('A key is lowercase letters, digits and underscores, starting with a letter.', 'providers.service_invalid');
  }
  if (input.label.trim() === '') throw new DomainError('Give the service a label.', 'providers.service_invalid');

  const { data, error } = await db.rpc('upsert_platform_provider_service', {
    p_provider_key: input.providerKey,
    p_key: input.key,
    p_label: input.label,
    p_description: input.description,
    p_family: input.family,
    p_kind: input.kind,
    p_implementation_state: input.implementationState,
    p_vendor_status: input.vendorStatus,
    p_auth_mode: input.authMode,
    p_docs_url: input.docsUrl ?? '',
    p_display_order: input.displayOrder,
    p_metadata: input.metadata as never,
  });
  if (error) throw forbidden(error, 'providers.service_write_failed');
  return data;
}

export async function setProviderServiceFeature(
  db: Db,
  input: { providerServiceId: string; featureId: string; note?: string },
): Promise<void> {
  const { error } = await db.rpc('set_provider_service_feature', {
    p_provider_service_id: input.providerServiceId,
    p_feature_id: input.featureId,
    p_relationship: 'supports',
    p_note: input.note ?? '',
  });
  if (error) throw forbidden(error, 'providers.service_feature_write_failed');
}

export async function removeProviderServiceFeature(
  db: Db,
  input: { providerServiceId: string; featureId: string },
): Promise<void> {
  const { error } = await db.rpc('remove_provider_service_feature', {
    p_provider_service_id: input.providerServiceId,
    p_feature_id: input.featureId,
  });
  if (error) throw forbidden(error, 'providers.service_feature_write_failed');
}
