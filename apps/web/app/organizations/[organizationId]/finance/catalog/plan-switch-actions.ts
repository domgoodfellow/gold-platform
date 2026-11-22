'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformCapability } from '@/lib/route/platform';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import {
  clearPlanFeatureOverride,
  getPlanById,
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
 * What a GildOps plan switches on (ADR-057), edited from the plan's own item in GildOps' Catalog &
 * Pricing. Two separate authorities meet here, and both are proved on the server before a write:
 * the Finance catalog area of the business the form names (which must be GildOps' operating
 * organization, the only seller of plans), and the Product Registry permission
 * (`platform.catalogue`), which the database functions check again. Neither stands in for the
 * other: pricing permission does not reach the switch list, and platform authority does not open
 * Finance.
 */

export type PlanActionState = { error: string | null; updated: boolean };

const field = (form: FormData, key: string) => String(form.get(key) ?? '');

async function authorize(form: FormData) {
  const organizationId = field(form, 'organizationId');
  const itemId = field(form, 'itemId');
  const planId = field(form, 'planId');
  const { db } = await requireOperatingArea(organizationId, 'finance-catalog');
  const goldId = await requirePlatformCapability('platform.catalogue');
  if (goldId !== organizationId) throw new DomainError('Only GildOps’ own business edits what a plan switches on.', 'plans.switches_forbidden');
  const plan = await getPlanById(db, planId);
  if (!plan || plan.priceBookItemId !== itemId) throw new DomainError('This item does not sell that plan.', 'plans.item_mismatch');
  return { db, organizationId, itemId, planId };
}

function refresh(organizationId: string, itemId: string) {
  revalidatePath(`/organizations/${organizationId}/finance/catalog/${itemId}`);
}

async function attempt(form: FormData, write: (context: Awaited<ReturnType<typeof authorize>>) => Promise<void>): Promise<PlanActionState> {
  try {
    const context = await authorize(form);
    await write(context);
    refresh(context.organizationId, context.itemId);
    return { error: null, updated: true };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
}

async function submit(form: FormData, write: (context: Awaited<ReturnType<typeof authorize>>) => Promise<void>): Promise<void> {
  const result = await attempt(form, write);
  if (result.error) throw new DomainError(result.error, 'plans.switch_failed');
}

export async function updatePlanSwitchesAction(_: PlanActionState, form: FormData): Promise<PlanActionState> {
  return attempt(form, ({ db, planId }) => updatePlanSwitches(db, {
    planId,
    billable: form.get('billable') === 'on',
    displayOrder: Number(form.get('displayOrder') ?? 0),
  }));
}

export async function grantPlanProductAction(form: FormData): Promise<void> {
  await submit(form, ({ db, planId }) => grantPlanProduct(db, { planId, productKey: field(form, 'productKey') }));
}

export async function revokePlanProductAction(form: FormData): Promise<void> {
  await submit(form, ({ db, planId }) => revokePlanProduct(db, { planId, productKey: field(form, 'productKey') }));
}

export async function grantPlanModuleAction(form: FormData): Promise<void> {
  await submit(form, ({ db, planId }) => grantPlanModule(db, { planId, moduleId: field(form, 'moduleId') }));
}

export async function revokePlanModuleAction(form: FormData): Promise<void> {
  await submit(form, ({ db, planId }) => revokePlanModule(db, { planId, moduleId: field(form, 'moduleId') }));
}

export async function grantPlanFeatureOverrideAction(form: FormData): Promise<void> {
  await submit(form, ({ db, planId }) => setPlanFeatureOverride(db, {
    planId,
    featureId: field(form, 'featureId'),
    included: field(form, 'included') === 'true',
  }));
}

export async function revokePlanFeatureOverrideAction(form: FormData): Promise<void> {
  await submit(form, ({ db, planId }) => clearPlanFeatureOverride(db, { planId, featureId: field(form, 'featureId') }));
}

export async function setPlanQuotaAction(_: PlanActionState, form: FormData): Promise<PlanActionState> {
  const hardLimitRaw = field(form, 'hardLimit').trim();
  return attempt(form, async ({ db, planId }) => { await setPlanQuota(db, {
    planId,
    allowanceKey: field(form, 'allowanceKey'),
    label: field(form, 'label'),
    unit: field(form, 'unit'),
    includedQuantity: Number(form.get('includedQuantity') ?? 0),
    period: (field(form, 'period') || 'month') as QuotaPeriod,
    hardLimit: hardLimitRaw === '' ? null : Number(hardLimitRaw),
    overagePolicy: (field(form, 'overagePolicy') || 'not_applicable') as OveragePolicy,
    overageBehavior: (field(form, 'overageBehavior') || 'not_applicable') as OverageBehavior,
    allowanceType: (field(form, 'allowanceType') || 'usage') as AllowanceType,
    resetSemantics: (field(form, 'resetSemantics') || 'billing_period') as 'billing_period' | 'calendar_period' | 'none',
    meterId: field(form, 'meterId') || null,
  }); });
}

export async function removePlanQuotaAction(form: FormData): Promise<void> {
  await submit(form, ({ db, planId }) => removePlanQuota(db, { planId, allowanceKey: field(form, 'allowanceKey') }));
}
