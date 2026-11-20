'use server';

import { requirePlatformCapability, revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import {
  clearPlanFeatureOverride,
  grantPlanModule,
  grantPlanProduct,
  removePlanQuota,
  revokePlanModule,
  revokePlanProduct,
  setPlanFeatureOverride,
  setPlanQuota,
  updatePlanSwitches,
  type OveragePolicy,
  type OverageBehavior,
  type AllowanceType,
  type QuotaPeriod,
} from '@/lib/domain/catalogue/plans';
import { DomainError } from '@/lib/domain/errors';

/**
 * Product Registry: what a plan switches on (ADR-057). Each action proves `platform.catalogue`
 * itself; the database checks it again. Prices, add-ons and sale status are GildOps' Finance.
 */

export type PlanActionState = { error: string | null; updated: boolean };

const CAPABILITY = 'platform.catalogue';

export async function updatePlanSwitchesAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  try {
    await requirePlatformCapability(CAPABILITY);
    await updatePlanSwitches(await getDb(), {
      planId: String(formData.get('planId') ?? ''),
      billable: formData.get('billable') === 'on',
      displayOrder: Number(formData.get('displayOrder') ?? 0),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}

export async function grantPlanProductAction(formData: FormData): Promise<void> {
  await requirePlatformCapability(CAPABILITY);
  await grantPlanProduct(await getDb(), { planId: String(formData.get('planId') ?? ''), productKey: String(formData.get('productKey') ?? '') });
  revalidatePlatform();
}

export async function revokePlanProductAction(formData: FormData): Promise<void> {
  await requirePlatformCapability(CAPABILITY);
  await revokePlanProduct(await getDb(), { planId: String(formData.get('planId') ?? ''), productKey: String(formData.get('productKey') ?? '') });
  revalidatePlatform();
}

export async function grantPlanModuleAction(formData: FormData): Promise<void> {
  await requirePlatformCapability(CAPABILITY);
  await grantPlanModule(await getDb(), { planId: String(formData.get('planId') ?? ''), moduleId: String(formData.get('moduleId') ?? '') });
  revalidatePlatform();
}

export async function revokePlanModuleAction(formData: FormData): Promise<void> {
  await requirePlatformCapability(CAPABILITY);
  await revokePlanModule(await getDb(), { planId: String(formData.get('planId') ?? ''), moduleId: String(formData.get('moduleId') ?? '') });
  revalidatePlatform();
}

export async function grantPlanFeatureOverrideAction(formData: FormData): Promise<void> {
  await requirePlatformCapability(CAPABILITY);
  await setPlanFeatureOverride(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    featureId: String(formData.get('featureId') ?? ''),
    included: String(formData.get('included')) === 'true',
  });
  revalidatePlatform();
}

export async function revokePlanFeatureOverrideAction(formData: FormData): Promise<void> {
  await requirePlatformCapability(CAPABILITY);
  await clearPlanFeatureOverride(await getDb(), { planId: String(formData.get('planId') ?? ''), featureId: String(formData.get('featureId') ?? '') });
  revalidatePlatform();
}

export async function setPlanQuotaAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const hardLimitRaw = String(formData.get('hardLimit') ?? '').trim();
  try {
    await requirePlatformCapability(CAPABILITY);
    await setPlanQuota(await getDb(), {
      planId: String(formData.get('planId') ?? ''),
      allowanceKey: String(formData.get('allowanceKey') ?? ''),
      label: String(formData.get('label') ?? ''),
      unit: String(formData.get('unit') ?? ''),
      includedQuantity: Number(formData.get('includedQuantity') ?? 0),
      period: String(formData.get('period') ?? 'month') as QuotaPeriod,
      hardLimit: hardLimitRaw === '' ? null : Number(hardLimitRaw),
      overagePolicy: String(formData.get('overagePolicy') ?? 'not_applicable') as OveragePolicy,
      overageBehavior: String(formData.get('overageBehavior') ?? 'not_applicable') as OverageBehavior,
      allowanceType: String(formData.get('allowanceType') ?? 'usage') as AllowanceType,
      resetSemantics: String(formData.get('resetSemantics') ?? 'billing_period') as 'billing_period' | 'calendar_period' | 'none',
      meterId: String(formData.get('meterId') ?? '') || null,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}

export async function removePlanQuotaAction(formData: FormData): Promise<void> {
  await requirePlatformCapability(CAPABILITY);
  await removePlanQuota(await getDb(), { planId: String(formData.get('planId') ?? ''), allowanceKey: String(formData.get('allowanceKey') ?? '') });
  revalidatePlatform();
}
