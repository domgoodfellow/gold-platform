'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import { recordPlanAgreement, recordPlanAssignment, recordPlanQuotaOverride } from '@/lib/domain/catalogue/organization-plans';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { provisionAgreementPlanPrice } from '@/lib/domain/platform-billing/provisioning';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import type { SubscriptionActionState } from './action-states';

/**
 * Changing a subscription of a business GildOps serves (ADR-057). The form names GildOps'
 * organization, whose Finance Subscriptions area and `subscription.manage` permission are proved
 * here; the database function proves the same permission in the operating organization again.
 * Platform authority is not consulted: it neither opens these doors nor stands in for them.
 */

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

type Area = Awaited<ReturnType<typeof requireOperatingArea>>;
type Seller = { db: Area['db']; organizationId: string; subscriberId: string };

function seller(area: Area, form: FormData): Seller {
  if (!area.organization.capabilities.includes('subscription.manage')) {
    throw new DomainError('Your role cannot change subscriptions.', 'subscriptions.forbidden');
  }
  return { db: area.db, organizationId: area.organization.id, subscriberId: field(form, 'subscriberId') };
}

async function attempt(area: Area, form: FormData, write: (context: Seller) => Promise<unknown>): Promise<SubscriptionActionState> {
  try {
    const context = seller(area, form);
    await write(context);
    revalidatePath(`/organizations/${context.organizationId}/finance/subscriptions`, 'layout');
    return { error: null, recorded: true };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }
}

export async function recordPlanAssignmentAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  return attempt(await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions'), form, ({ db, subscriberId }) => recordPlanAssignment(db, {
    organizationId: subscriberId,
    planId: field(form, 'planId'),
    periodStart: field(form, 'periodStart'),
    periodEnd: field(form, 'periodEnd'),
    note: field(form, 'note'),
  }));
}

export async function recordPlanAgreementAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const effectiveTo = field(form, 'effectiveTo');
  return attempt(await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions'), form, ({ db, subscriberId }) => recordPlanAgreement(db, {
    organizationId: subscriberId,
    planId: field(form, 'planId'),
    currency: field(form, 'currency').toUpperCase(),
    amountMinor: Math.round(Number(form.get('amount') ?? 0) * 100),
    effectiveFrom: new Date(field(form, 'effectiveFrom')).toISOString(),
    effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null,
    note: field(form, 'note'),
  }));
}

export async function recordPlanQuotaOverrideAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const hard = field(form, 'hardLimit');
  return attempt(await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions'), form, ({ db, subscriberId }) => recordPlanQuotaOverride(db, {
    organizationId: subscriberId,
    planId: field(form, 'planId'),
    allowanceKey: field(form, 'allowanceKey'),
    includedQuantity: Number(form.get('includedQuantity') ?? 0),
    hardLimit: hard ? Number(hard) : null,
    effectiveFrom: new Date(field(form, 'effectiveFrom')).toISOString(),
    note: field(form, 'note'),
  }));
}

export async function recordCommercialTermAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  return attempt(await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions'), form, ({ db, subscriberId }) => recordCommercialTerm(db, {
    organizationId: subscriberId,
    productKey: field(form, 'productKey'),
    periodStart: field(form, 'periodStart'),
    periodEnd: field(form, 'periodEnd'),
    priceMinor: Number(form.get('priceMinor') ?? 0),
    currency: field(form, 'currency') || undefined,
  }));
}

/**
 * Prepares the agreed price a business pays for its plan for checkout with GildOps' billing
 * provider, once; repeating it reads the reference back. Same authority as recording the price.
 */
export async function prepareAgreedPriceAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  return attempt(await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions'), form, ({ db, subscriberId }) => provisionAgreementPlanPrice(db, {
    organizationId: subscriberId,
    planId: field(form, 'planId'),
    billingInterval: 'month',
  }));
}

