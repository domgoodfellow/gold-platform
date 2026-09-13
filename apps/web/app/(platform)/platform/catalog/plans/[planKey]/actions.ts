'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import {
  clearPlanFeatureOverride,
  grantPlanModule,
  grantPlanProduct,
  recordPlanPrice,
  removePlanQuota,
  revokePlanModule,
  revokePlanProduct,
  setPlanFeatureOverride,
  setPlanQuota,
  updatePlan,
  type OveragePolicy,
  type QuotaPeriod,
  type SaleStatus,
} from '@/lib/domain/catalogue/plans';
import { DomainError } from '@/lib/domain/errors';

export type PlanActionState = { error: string | null; updated: boolean };

function planPath(planKey: string): string {
  return `/platform/catalog/plans/${planKey}`;
}

export async function updatePlanAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const planKey = String(formData.get('planKey') ?? '');
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
  revalidatePath(planPath(planKey));
  revalidatePath('/platform/catalog/plans');
  return { error: null, updated: true };
}

export async function grantPlanProductAction(formData: FormData): Promise<void> {
  await grantPlanProduct(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    productKey: String(formData.get('productKey') ?? ''),
  });
  revalidatePath(planPath(String(formData.get('planKey') ?? '')));
}

export async function revokePlanProductAction(formData: FormData): Promise<void> {
  await revokePlanProduct(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    productKey: String(formData.get('productKey') ?? ''),
  });
  revalidatePath(planPath(String(formData.get('planKey') ?? '')));
}

export async function grantPlanModuleAction(formData: FormData): Promise<void> {
  await grantPlanModule(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    moduleId: String(formData.get('moduleId') ?? ''),
  });
  revalidatePath(planPath(String(formData.get('planKey') ?? '')));
}

export async function revokePlanModuleAction(formData: FormData): Promise<void> {
  await revokePlanModule(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    moduleId: String(formData.get('moduleId') ?? ''),
  });
  revalidatePath(planPath(String(formData.get('planKey') ?? '')));
}

export async function grantPlanFeatureOverrideAction(formData: FormData): Promise<void> {
  await setPlanFeatureOverride(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    featureId: String(formData.get('featureId') ?? ''),
    included: String(formData.get('included')) === 'true',
  });
  revalidatePath(planPath(String(formData.get('planKey') ?? '')));
}

export async function revokePlanFeatureOverrideAction(formData: FormData): Promise<void> {
  await clearPlanFeatureOverride(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    featureId: String(formData.get('featureId') ?? ''),
  });
  revalidatePath(planPath(String(formData.get('planKey') ?? '')));
}

export async function setPlanQuotaAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const planKey = String(formData.get('planKey') ?? '');
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
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePath(planPath(planKey));
  return { error: null, updated: true };
}

export async function removePlanQuotaAction(formData: FormData): Promise<void> {
  await removePlanQuota(await getDb(), {
    planId: String(formData.get('planId') ?? ''),
    allowanceKey: String(formData.get('allowanceKey') ?? ''),
  });
  revalidatePath(planPath(String(formData.get('planKey') ?? '')));
}

export async function recordPlanPriceAction(_: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const planKey = String(formData.get('planKey') ?? '');
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
  revalidatePath(planPath(planKey));
  return { error: null, updated: true };
}
