'use server';

import { revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import {
  updateCatalogFeature,
  updateCatalogModule,
  updateCatalogProduct,
  type CatalogProductKey,
  type ImplementationState,
  type Lifecycle,
  type PackagingDefault,
  type SaleStatus,
} from '@/lib/domain/catalogue/catalogue';
import { DomainError } from '@/lib/domain/errors';

export type FormState = { error: string | null; updated: boolean };

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function updateCatalogProductAction(_: FormState, formData: FormData): Promise<FormState> {
  const familyKey = String(formData.get('familyKey') ?? '');
  try {
    await updateCatalogProduct(await getDb(), {
      // The key CHECK constraint (and update_catalog_product's own lookup) is the real
      // validation; this cast just satisfies the domain type from a route param.
      key: familyKey as CatalogProductKey,
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      lifecycle: String(formData.get('lifecycle') ?? 'stable') as Lifecycle,
      saleStatus: String(formData.get('saleStatus') ?? 'active') as SaleStatus,
      displayOrder: Number(formData.get('displayOrder') ?? 0),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}

export async function updateCatalogModuleAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await updateCatalogModule(await getDb(), {
      moduleId: String(formData.get('moduleId') ?? ''),
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      displayOrder: Number(formData.get('displayOrder') ?? 0),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}

export async function updateCatalogFeatureAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await updateCatalogFeature(await getDb(), {
      featureId: String(formData.get('featureId') ?? ''),
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      lifecycle: String(formData.get('lifecycle') ?? 'stable') as Lifecycle,
      implementationState: String(formData.get('implementationState') ?? 'planned') as ImplementationState,
      packagingDefault: String(formData.get('packagingDefault') ?? 'optional') as PackagingDefault,
      saleStatus: String(formData.get('saleStatus') ?? 'active') as SaleStatus,
      metered: formData.get('metered') === 'on',
      aiPowered: formData.get('aiPowered') === 'on',
      meterIds: parseList(formData.get('meterIds')),
      providerCapabilities: parseList(formData.get('providerCapabilities')),
      displayOrder: Number(formData.get('displayOrder') ?? 0),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}
