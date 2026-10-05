'use server';

import { revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import {
  clearPlanFeatureOverride,
  grantPlanModule,
  grantPlanProduct,
  recordPlanPrice,
  recordPlanOverageRate,
  recordPlanMarginPolicy,
  recordPlanUtilizationAssumption,
  setPlanAddon,
  removePlanQuota,
  revokePlanModule,
  revokePlanProduct,
  setPlanFeatureOverride,
  setPlanQuota,
  updatePlan,
  type OveragePolicy,
  type OverageBehavior,
  type AllowanceType,
  type QuotaPeriod,
  type SaleStatus,
} from '@/lib/domain/catalogue/plans';
import { DomainError } from '@/lib/domain/errors';

export type PlanActionState = { error: string | null; updated: boolean };

export async function updatePlanAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  try {
    await updatePlan(await getDb(), {
      planId: String(formData.get('planId') ?? ''),
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      billable: formData.get('billable') === 'on',
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

export async function grantPlanProductAction(formData: FormData): Promise<void> {
  await grantPlanProduct(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    productKey: String(formData.get('productKey') ?? ''),
  });
  revalidatePlatform();
}

export async function revokePlanProductAction(formData: FormData): Promise<void> {
  await revokePlanProduct(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    productKey: String(formData.get('productKey') ?? ''),
  });
  revalidatePlatform();
}

export async function grantPlanModuleAction(formData: FormData): Promise<void> {
  await grantPlanModule(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    moduleId: String(formData.get('moduleId') ?? ''),
  });
  revalidatePlatform();
}

export async function revokePlanModuleAction(formData: FormData): Promise<void> {
  await revokePlanModule(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    moduleId: String(formData.get('moduleId') ?? ''),
  });
  revalidatePlatform();
}

export async function grantPlanFeatureOverrideAction(formData: FormData): Promise<void> {
  await setPlanFeatureOverride(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    featureId: String(formData.get('featureId') ?? ''),
    included: String(formData.get('included')) === 'true',
  });
  revalidatePlatform();
}

export async function revokePlanFeatureOverrideAction(formData: FormData): Promise<void> {
  await clearPlanFeatureOverride(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    featureId: String(formData.get('featureId') ?? ''),
  });
  revalidatePlatform();
}

export async function setPlanQuotaAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const hardLimitRaw = String(formData.get('hardLimit') ?? '').trim();
  try {
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
  await removePlanQuota(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    allowanceKey: String(formData.get('allowanceKey') ?? ''),
  });
  revalidatePlatform();
}

export async function recordPlanPriceAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  try {
    const amount = Number(formData.get('amount') ?? 0);
    await recordPlanPrice(await getDb(), {
      planId: String(formData.get('planId') ?? ''),
      currency: String(formData.get('currency') ?? '').toUpperCase(),
      amountMinor: Math.round(amount * 100),
      billingInterval: String(formData.get('billingInterval') ?? 'month') as 'month' | 'year' | 'one_time',
      effectiveFrom: new Date(String(formData.get('effectiveFrom') ?? '')).toISOString(),
      source: String(formData.get('source') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}

export async function recordPlanOverageRateAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  try {
    await recordPlanOverageRate(await getDb(), {
      planId: String(formData.get('planId') ?? ''),
      meterId: String(formData.get('meterId') ?? ''),
      currency: String(formData.get('currency') ?? '').toUpperCase(),
      unitAmountMicros: Math.round(Number(formData.get('amount') ?? 0) * 100_000_000),
      effectiveFrom: new Date(String(formData.get('effectiveFrom') ?? '')).toISOString(),
      source: String(formData.get('source') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}

export async function savePlanEconomicsSettingsAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  try {
    const db = await getDb();
    const planId = String(formData.get('planId') ?? '');
    const effectiveFrom = new Date(String(formData.get('effectiveFrom') ?? '')).toISOString();
    const source = String(formData.get('source') ?? 'Staff planning assumption');
    await recordPlanMarginPolicy(db, { planId, currency: String(formData.get('currency') ?? 'CAD'), targetMargin: Number(formData.get('targetMargin')) / 100, warningMargin: Number(formData.get('warningMargin')) / 100, hardFloorMargin: Number(formData.get('hardFloorMargin')) / 100, effectiveFrom, source });
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('utilization:') || String(value).trim() === '') continue;
      const [, scenario, allowanceKey] = key.split(':');
      await recordPlanUtilizationAssumption(db, { planId, scenario: scenario as 'expected' | 'heavy', allowanceKey, utilization: Number(value) / 100, effectiveFrom, source });
    }
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePlatform();
  return { error: null, updated: true };
}

export async function setPlanAddonAction(formData: FormData): Promise<void> {
  await setPlanAddon(await getDb(), { planId: String(formData.get('planId') ?? ''), addonPlanId: String(formData.get('addonPlanId') ?? ''), attached: formData.get('attached') === 'true' });
  revalidatePlatform();
}
