'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import { recordPlanQuotaOverride } from '@/lib/domain/catalogue/organization-plans';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { provisionAgreementPlanPrice } from '@/lib/domain/platform-billing/provisioning';
import {
  addSubscriptionAddon,
  cancelSubscription,
  changeSubscriptionItem,
  createSubscription,
  endSubscriptionAddon,
  issueSubscriptionInvoice,
  setSubscriptionPrice,
  setSubscriptionUsagePrice,
  type SubscriptionInterval,
} from '@/lib/domain/subscriptions/subscriptions';
import { parseMicrosInput, parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import type { SubscriptionActionState } from './action-states';

/**
 * Changing a business's subscriptions with its own customers (ADR-057). The form names the selling
 * business, whose Finance → Subscriptions area and `subscription.manage` permission are proved here;
 * the database function proves the same permission again. Every change is a new dated record.
 */

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/** An amount typed in the subscription currency's major unit ("49.00"), as whole minor units, or null when left empty. */
function minorFrom(form: FormData, key: string): number | null {
  const raw = field(form, key).replace(/,/g, '');
  return raw ? parseMoneyInput(raw, field(form, 'currency') || 'CAD') : null;
}

/** A usage price typed in the currency's major unit ("0.012"), as micros, or null when left empty. */
function microsFrom(form: FormData, key: string): number | null {
  const raw = field(form, key).replace(/,/g, '');
  return raw ? parseMicrosInput(raw, field(form, 'currency') || 'CAD') : null;
}

type Area = Awaited<ReturnType<typeof requireOperatingArea>>;

/** Changing a subscription takes `subscription.manage` in that business. */
const mayManage = (context: Area) => context.organization.capabilities.includes('subscription.manage');
/** Invoicing a period takes `invoice.issue` in that business. */
const mayIssue = (context: Area) => context.organization.capabilities.includes('invoice.issue');

async function attempt(context: Area, permitted: boolean, write: (context: Area) => Promise<unknown>): Promise<SubscriptionActionState> {
  try {
    if (!permitted) throw new DomainError('Your role cannot do that here.', 'subscriptions.forbidden');
    const result = await write(context);
    revalidatePath(`/organizations/${context.organization.id}/finance/subscriptions`, 'layout');
    return { error: null, recorded: true, id: typeof result === 'string' ? result : null };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false, id: null };
    throw error;
  }
}

export async function createSubscriptionAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db, organization }) => {
    if (!field(form, 'customerId')) throw new DomainError('Choose a customer.', 'subscriptions.customer_required');
    if (!field(form, 'itemId')) throw new DomainError('Choose a recurring item.', 'subscriptions.item_required');
    return createSubscription(db, {
      organizationId: organization.id,
      customerId: field(form, 'customerId'),
      itemId: field(form, 'itemId'),
      currency: field(form, 'currency').toUpperCase() || (organization.currency ?? ''),
      billingInterval: (field(form, 'billingInterval') || 'month') as SubscriptionInterval,
      startsOn: field(form, 'startsOn'),
      endsOn: field(form, 'endsOn') || null,
      quantity: Number(field(form, 'quantity') || '1'),
      agreedAmountMinor: minorFrom(form, 'agreedAmount'),
      note: field(form, 'note'),
    });
  });
}

export async function addSubscriptionAddonAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => addSubscriptionAddon(db, {
    subscriptionId: field(form, 'subscriptionId'),
    itemId: field(form, 'itemId'),
    startsOn: field(form, 'startsOn'),
    quantity: Number(field(form, 'quantity') || '1'),
    agreedAmountMinor: minorFrom(form, 'agreedAmount'),
    note: field(form, 'note'),
  }));
}

export async function changeSubscriptionItemAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => changeSubscriptionItem(db, {
    subscriptionId: field(form, 'subscriptionId'),
    itemId: field(form, 'itemId'),
    effectiveOn: field(form, 'effectiveOn'),
    agreedAmountMinor: minorFrom(form, 'agreedAmount'),
    note: field(form, 'note'),
  }));
}

/** An agreed price for one line from now; "List price" returns the line to its item's list price. */
export async function setSubscriptionPriceAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => {
    const amountMinor = field(form, 'basis') === 'list' ? null : minorFrom(form, 'amount');
    if (field(form, 'basis') !== 'list' && amountMinor === null) throw new DomainError('Enter the agreed price.', 'subscriptions.amount_required');
    return setSubscriptionPrice(db, { lineId: field(form, 'lineId'), amountMinor, note: field(form, 'note') });
  });
}

export async function endSubscriptionAddonAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => endSubscriptionAddon(db, { lineId: field(form, 'lineId'), endsOn: field(form, 'endsOn') }));
}

export async function cancelSubscriptionAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => cancelSubscription(db, {
    subscriptionId: field(form, 'subscriptionId'),
    endsOn: field(form, 'endsOn'),
    reason: field(form, 'reason'),
  }));
}

export async function issueSubscriptionInvoiceAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayIssue(context), ({ db }) => issueSubscriptionInvoice(db, {
    subscriptionId: field(form, 'subscriptionId'),
    dueAt: field(form, 'dueOn') ? new Date(`${field(form, 'dueOn')}T23:59:59Z`).toISOString() : null,
    issuanceKey: field(form, 'issuanceKey'),
  }));
}

/** An agreed usage price for one plan line and meter, from now; empty returns it to the plan's usage price. */
export async function setSubscriptionUsagePriceAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => setSubscriptionUsagePrice(db, {
    lineId: field(form, 'lineId'),
    meterId: field(form, 'meterId'),
    unitAmountMicros: microsFrom(form, 'unitAmount'),
  }));
}

/** An allowance changed for the business this subscription provisions. */
export async function recordPlanQuotaOverrideAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  const hard = field(form, 'hardLimit');
  return attempt(context, mayManage(context), ({ db }) => recordPlanQuotaOverride(db, {
    organizationId: field(form, 'tenantId'),
    planId: field(form, 'planId'),
    allowanceKey: field(form, 'allowanceKey'),
    includedQuantity: Number(form.get('includedQuantity') ?? 0),
    hardLimit: hard ? Number(hard) : null,
    effectiveFrom: new Date(field(form, 'effectiveFrom')).toISOString(),
    note: field(form, 'note'),
  }));
}

/** A per-product term for the business this subscription provisions, as recorded before plans. */
export async function recordCommercialTermAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => recordCommercialTerm(db, {
    organizationId: field(form, 'tenantId'),
    productKey: field(form, 'productKey'),
    periodStart: field(form, 'periodStart'),
    periodEnd: field(form, 'periodEnd'),
    priceMinor: Number(form.get('priceMinor') ?? 0),
    currency: field(form, 'termCurrency') || undefined,
  }));
}

/**
 * Prepares the agreed price a provisioned business pays for its plan for checkout with the billing
 * provider, once; repeating it reads the reference back.
 */
export async function prepareAgreedPriceAction(_: SubscriptionActionState, form: FormData): Promise<SubscriptionActionState> {
  const context = await requireOperatingArea(field(form, 'organizationId'), 'finance-subscriptions');
  return attempt(context, mayManage(context), ({ db }) => provisionAgreementPlanPrice(db, {
    organizationId: field(form, 'tenantId'),
    planId: field(form, 'planId'),
    billingInterval: 'month',
  }));
}
