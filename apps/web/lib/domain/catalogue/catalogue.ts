import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * The canonical customer-facing catalogue: Product -> Module -> Feature.
 *
 * Distinct from `lib/domain/commercial/catalogue.ts`, which stays exactly what it was —
 * `platform_products`, GOLD's flat sellable-line-item vocabulary, load-bearing in historical
 * terms. This file is the layer above it: seven locked Products, their Modules, and a curated,
 * truthfully-stated set of Features. A Feature may reference a legacy `platform_products`/
 * `MODULES` key through a runtime mapping without either older system changing shape.
 */

export type Lifecycle = 'experimental' | 'beta' | 'stable' | 'deprecated';
export type ImplementationState = 'planned' | 'partial' | 'available';
export type PackagingDefault = 'core' | 'included' | 'optional' | 'add_on';
export type SaleStatus = 'active' | 'unlisted' | 'archived';

export type CatalogProductKey =
  | 'crm'
  | 'communications'
  | 'operations'
  | 'financial_operations'
  | 'automation'
  | 'insights'
  | 'customer_experience';

export type CatalogProduct = {
  id: string;
  key: CatalogProductKey;
  label: string;
  description: string;
  lifecycle: Lifecycle;
  saleStatus: SaleStatus;
  displayOrder: number;
};

export type CatalogModule = {
  id: string;
  productId: string;
  key: string;
  label: string;
  description: string;
  displayOrder: number;
};

export type CatalogFeature = {
  id: string;
  moduleId: string;
  key: string;
  label: string;
  description: string;
  lifecycle: Lifecycle;
  implementationState: ImplementationState;
  packagingDefault: PackagingDefault;
  saleStatus: SaleStatus;
  metered: boolean;
  aiPowered: boolean;
  meterIds: string[];
  providerCapabilities: string[];
  displayOrder: number;
};

export type RuntimeMapping = {
  id: string;
  featureId: string;
  mappingKind: 'module_key' | 'product_key' | 'capability_key' | 'provider_key' | 'kernel';
  mappingValue: string;
  note: string;
};

export type FeatureDependency = {
  featureId: string;
  requiresFeatureId: string;
};

function toProduct(row: {
  id: string;
  key: string;
  label: string;
  description: string;
  lifecycle: string;
  sale_status: string;
  display_order: number;
}): CatalogProduct {
  return {
    id: row.id,
    key: row.key as CatalogProductKey,
    label: row.label,
    description: row.description,
    lifecycle: row.lifecycle as Lifecycle,
    saleStatus: row.sale_status as SaleStatus,
    displayOrder: row.display_order,
  };
}

function toModule(row: {
  id: string;
  product_id: string;
  key: string;
  label: string;
  description: string;
  display_order: number;
}): CatalogModule {
  return {
    id: row.id,
    productId: row.product_id,
    key: row.key,
    label: row.label,
    description: row.description,
    displayOrder: row.display_order,
  };
}

function toFeature(row: {
  id: string;
  module_id: string;
  key: string;
  label: string;
  description: string;
  lifecycle: string;
  implementation_state: string;
  packaging_default: string;
  sale_status: string;
  metered: boolean;
  ai_powered: boolean;
  meter_ids: string[] | null;
  provider_capabilities: string[] | null;
  display_order: number;
}): CatalogFeature {
  return {
    id: row.id,
    moduleId: row.module_id,
    key: row.key,
    label: row.label,
    description: row.description,
    lifecycle: row.lifecycle as Lifecycle,
    implementationState: row.implementation_state as ImplementationState,
    packagingDefault: row.packaging_default as PackagingDefault,
    saleStatus: row.sale_status as SaleStatus,
    metered: row.metered,
    aiPowered: row.ai_powered,
    meterIds: row.meter_ids ?? [],
    providerCapabilities: row.provider_capabilities ?? [],
    displayOrder: row.display_order,
  };
}

const PRODUCT_COLUMNS = 'id, key, label, description, lifecycle, sale_status, display_order';
const MODULE_COLUMNS = 'id, product_id, key, label, description, display_order';
const FEATURE_COLUMNS =
  'id, module_id, key, label, description, lifecycle, implementation_state, packaging_default, sale_status, metered, ai_powered, meter_ids, provider_capabilities, display_order';

export async function listCatalogProducts(db: Db): Promise<CatalogProduct[]> {
  const { data, error } = await db
    .from('platform_catalog_products')
    .select(PRODUCT_COLUMNS)
    .order('display_order');
  if (error) throw new DomainError(error.message, 'catalogue.products_failed');
  return (data ?? []).map(toProduct);
}

export async function getCatalogProduct(db: Db, key: string): Promise<CatalogProduct | null> {
  const { data, error } = await db
    .from('platform_catalog_products')
    .select(PRODUCT_COLUMNS)
    .eq('key', key)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'catalogue.product_failed');
  return data ? toProduct(data) : null;
}

export async function listCatalogModules(db: Db, input: { productId?: string } = {}): Promise<CatalogModule[]> {
  let query = db.from('platform_catalog_modules').select(MODULE_COLUMNS).order('display_order');
  if (input.productId) query = query.eq('product_id', input.productId);
  const { data, error } = await query;
  if (error) throw new DomainError(error.message, 'catalogue.modules_failed');
  return (data ?? []).map(toModule);
}

export async function getCatalogModule(db: Db, moduleId: string): Promise<CatalogModule | null> {
  const { data, error } = await db
    .from('platform_catalog_modules')
    .select(MODULE_COLUMNS)
    .eq('id', moduleId)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'catalogue.module_failed');
  return data ? toModule(data) : null;
}

export async function listCatalogFeatures(db: Db, input: { moduleId?: string } = {}): Promise<CatalogFeature[]> {
  let query = db.from('platform_catalog_features').select(FEATURE_COLUMNS).order('display_order');
  if (input.moduleId) query = query.eq('module_id', input.moduleId);
  const { data, error } = await query;
  if (error) throw new DomainError(error.message, 'catalogue.features_failed');
  return (data ?? []).map(toFeature);
}

export async function getCatalogFeature(db: Db, featureId: string): Promise<CatalogFeature | null> {
  const { data, error } = await db
    .from('platform_catalog_features')
    .select(FEATURE_COLUMNS)
    .eq('id', featureId)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'catalogue.feature_failed');
  return data ? toFeature(data) : null;
}

export async function listRuntimeMappings(db: Db, featureId: string): Promise<RuntimeMapping[]> {
  const { data, error } = await db
    .from('platform_catalog_runtime_mappings')
    .select('id, feature_id, mapping_kind, mapping_value, note')
    .eq('feature_id', featureId)
    .order('mapping_kind');
  if (error) throw new DomainError(error.message, 'catalogue.runtime_mappings_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    featureId: row.feature_id,
    mappingKind: row.mapping_kind as RuntimeMapping['mappingKind'],
    mappingValue: row.mapping_value,
    note: row.note,
  }));
}

/** Every Feature backed by the same legacy runtime key — the cross-Product mapping (`reception` backs both Communications/Voice and CRM/Sales). */
export async function listFeaturesByRuntimeMapping(
  db: Db,
  input: { mappingKind: RuntimeMapping['mappingKind']; mappingValue: string },
): Promise<CatalogFeature[]> {
  const { data, error } = await db
    .from('platform_catalog_runtime_mappings')
    .select(`feature:platform_catalog_features!inner(${FEATURE_COLUMNS})`)
    .eq('mapping_kind', input.mappingKind)
    .eq('mapping_value', input.mappingValue);
  if (error) throw new DomainError(error.message, 'catalogue.features_by_mapping_failed');
  return (data ?? []).flatMap((row) => {
    const feature = row.feature as unknown as Parameters<typeof toFeature>[0] | null;
    return feature ? [toFeature(feature)] : [];
  });
}

export async function listFeatureDependencies(db: Db, featureId: string): Promise<FeatureDependency[]> {
  const { data, error } = await db
    .from('platform_catalog_feature_dependencies')
    .select('feature_id, requires_feature_id')
    .eq('feature_id', featureId);
  if (error) throw new DomainError(error.message, 'catalogue.dependencies_failed');
  return (data ?? []).map((row) => ({ featureId: row.feature_id, requiresFeatureId: row.requires_feature_id }));
}

export type UpdateCatalogProductInput = Pick<
  CatalogProduct,
  'key' | 'label' | 'description' | 'lifecycle' | 'saleStatus' | 'displayOrder'
>;

export async function updateCatalogProduct(db: Db, input: UpdateCatalogProductInput): Promise<void> {
  const { error } = await db.rpc('update_catalog_product', {
    p_key: input.key,
    p_label: input.label,
    p_description: input.description,
    p_lifecycle: input.lifecycle,
    p_sale_status: input.saleStatus,
    p_display_order: input.displayOrder,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may edit the catalogue.' : error.message,
      'catalogue.update_product_failed',
    );
  }
}

export type UpdateCatalogModuleInput = { moduleId: string; label: string; description: string; displayOrder: number };

export async function updateCatalogModule(db: Db, input: UpdateCatalogModuleInput): Promise<void> {
  const { error } = await db.rpc('update_catalog_module', {
    p_module_id: input.moduleId,
    p_label: input.label,
    p_description: input.description,
    p_display_order: input.displayOrder,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may edit the catalogue.' : error.message,
      'catalogue.update_module_failed',
    );
  }
}

export type UpdateCatalogFeatureInput = {
  featureId: string;
  label: string;
  description: string;
  lifecycle: Lifecycle;
  implementationState: ImplementationState;
  packagingDefault: PackagingDefault;
  saleStatus: SaleStatus;
  metered: boolean;
  aiPowered: boolean;
  meterIds: string[];
  providerCapabilities: string[];
  displayOrder: number;
};

export async function updateCatalogFeature(db: Db, input: UpdateCatalogFeatureInput): Promise<void> {
  const { error } = await db.rpc('update_catalog_feature', {
    p_feature_id: input.featureId,
    p_label: input.label,
    p_description: input.description,
    p_lifecycle: input.lifecycle,
    p_implementation_state: input.implementationState,
    p_packaging_default: input.packagingDefault,
    p_sale_status: input.saleStatus,
    p_metered: input.metered,
    p_ai_powered: input.aiPowered,
    p_meter_ids: input.meterIds,
    p_provider_capabilities: input.providerCapabilities,
    p_display_order: input.displayOrder,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may edit the catalogue.' : error.message,
      'catalogue.update_feature_failed',
    );
  }
}
