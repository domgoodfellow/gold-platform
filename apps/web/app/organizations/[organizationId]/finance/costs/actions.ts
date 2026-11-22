'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import { recordProviderCostRate } from '@/lib/domain/commercial/catalogue';
import { recordInfrastructureCost, type AllocationQuality, type CostCategory } from '@/lib/domain/commercial/infrastructure-costs';
import { parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import type { CostComponentState, SupplierRateState } from './action-states';

const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/**
 * Records what a supplier charges per unit of usage (ADR-057). The Finance Costs area and
 * `cost.manage` in the business the form names are proved here; the database function proves
 * `cost.manage` in GildOps' operating organization again. Platform authority is not consulted.
 */
export async function recordSupplierRateAction(_: SupplierRateState, form: FormData): Promise<SupplierRateState> {
  const organizationId = value(form, 'organizationId');
  try {
    const { db, organization } = await requireOperatingArea(organizationId, 'finance-costs');
    if (!organization.capabilities.includes('cost.manage')) throw new DomainError('Your role cannot record supplier costs.', 'costs.forbidden');
    const direction = value(form, 'direction');
    await recordProviderCostRate(db, {
      providerKey: value(form, 'providerKey'),
      commercialMeterId: value(form, 'commercialMeterId'),
      costMeterKey: value(form, 'costMeterKey'),
      currency: value(form, 'currency').toUpperCase(),
      unitAmountMicros: Number(form.get('unitAmountMicros')),
      effectiveFrom: new Date(value(form, 'effectiveFrom')).toISOString(),
      source: value(form, 'source'),
      region: value(form, 'region') || undefined,
      direction: direction === 'inbound' || direction === 'outbound' ? direction : undefined,
      resourceType: value(form, 'resourceType') || undefined,
      note: value(form, 'note'),
    });
  } catch (error) {
    if (error instanceof DomainError || error instanceof RangeError) return { error: error.message, recorded: false };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/finance/costs`);
  return { error: null, recorded: true };
}

const CATEGORIES: readonly CostCategory[] = ['resource_direct', 'infrastructure_attributable', 'infrastructure_shared', 'manual_direct'];
const QUALITIES: readonly AllocationQuality[] = ['direct', 'measured', 'estimated', 'shared', 'unallocated'];

/**
 * Records one cost component for a billing month: a hosting bill, a resource or a manual cost,
 * attributed to one business or shared. Same authority as a supplier rate (`cost.manage`).
 */
export async function recordCostComponentAction(_: CostComponentState, form: FormData): Promise<CostComponentState> {
  const organizationId = value(form, 'organizationId');
  try {
    const { db, organization } = await requireOperatingArea(organizationId, 'finance-costs');
    if (!organization.capabilities.includes('cost.manage')) throw new DomainError('Your role cannot record costs.', 'costs.forbidden');
    const costCategory = value(form, 'costCategory') as CostCategory;
    const allocationQuality = value(form, 'allocationQuality') as AllocationQuality;
    if (!CATEGORIES.includes(costCategory)) throw new DomainError('Choose what kind of cost this is.', 'costs.category_invalid');
    if (!QUALITIES.includes(allocationQuality)) throw new DomainError('Choose how the cost is allocated.', 'costs.allocation_invalid');
    const currency = value(form, 'currency').toUpperCase();
    const minor = parseMoneyInput(value(form, 'amount'), currency);
    await recordInfrastructureCost(db, {
      costCategory,
      allocationQuality,
      billingPeriod: `${value(form, 'billingMonth')}-01`,
      nativeCostMicros: minor * 1_000_000,
      nativeCurrency: currency,
      source: value(form, 'source'),
      organizationId: value(form, 'subscriberId') || null,
      providerKey: value(form, 'providerKey') || null,
      note: value(form, 'note'),
    });
  } catch (error) {
    if (error instanceof DomainError || error instanceof RangeError) return { error: error.message, recorded: false };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/finance/costs`);
  return { error: null, recorded: true };
}

