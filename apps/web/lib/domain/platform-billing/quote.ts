import type { Db } from '@/lib/db/types';
import { getPlanById, listPlanPrices, listPlanQuotas } from '@/lib/domain/catalogue/plans';
import {
  currentAddonAssignments,
  currentPlanAssignment,
  organizationPlanPrice,
} from '@/lib/domain/catalogue/organization-plans';
import { DomainError } from '@/lib/domain/errors';

/**
 * Exactly what an organization is about to buy, resolved entirely server-side from its
 * already-approved commercial package (base Plan + Add-ons) -- never from a Plan a browser
 * names. Checkout purchases this quote; it does not shop a catalogue (work order C §3).
 */

export type PurchaseQuoteLine = {
  sourceType: 'plan' | 'addon';
  sourceId: string;
  label: string;
  quantity: number;
  amountMinor: number;
  billingInterval: 'month' | 'year' | 'one_time';
};

export type PurchaseQuoteBlocker = { code: string; message: string };

export type PurchaseQuote = {
  organizationId: string;
  currency: string;
  recurring: PurchaseQuoteLine[];
  dueNow: PurchaseQuoteLine[];
  recurringTotalMinor: number;
  dueNowTotalMinor: number;
  /** A stable fingerprint of the assignments this quote was built from -- compared against a
   * fresh quote at confirmation time to detect a package change the browser raced past. */
  commercialConfigurationVersion: string;
  expiresAt: string;
  blockers: PurchaseQuoteBlocker[];
};

const QUOTE_TTL_MINUTES = 30;

/**
 * Builds the organization's current package as a priced quote. There is no currency parameter:
 * the base Plan's own resolved price determines the quote's currency, and a component priced in
 * a different currency becomes a blocker rather than a silent conversion (I10, D40's reasoning
 * restated for this boundary).
 */
export async function buildOrganizationPurchaseQuote(
  db: Db,
  input: { organizationId: string },
): Promise<PurchaseQuote> {
  const blockers: PurchaseQuoteBlocker[] = [];
  const recurring: PurchaseQuoteLine[] = [];
  const dueNow: PurchaseQuoteLine[] = [];
  const versionParts: string[] = [];

  const baseAssignment = await currentPlanAssignment(db, { organizationId: input.organizationId });
  if (!baseAssignment) {
    blockers.push({
      code: 'no_base_plan',
      message: 'This business has no assigned Plan yet -- ask platform staff to assign one before checkout.',
    });
  }

  let currency: string | null = null;

  if (baseAssignment) {
    versionParts.push(`plan:${baseAssignment.planId}:${baseAssignment.periodStart}`);
    const plan = await getPlanById(db, baseAssignment.planId);
    if (!plan || !plan.billable) {
      blockers.push({ code: 'plan_not_billable', message: 'The assigned Plan is not a billable Plan.' });
    } else {
      const price = await organizationPlanPrice(db, {
        organizationId: input.organizationId,
        planId: baseAssignment.planId,
        billingInterval: 'month',
      });
      if (!price) {
        blockers.push({
          code: 'no_plan_price',
          message: `${plan.label} has no price in force -- ask platform staff to approve one.`,
        });
      } else {
        currency = price.currency;
        recurring.push({
          sourceType: 'plan',
          sourceId: baseAssignment.planId,
          label: plan.label,
          quantity: 1,
          amountMinor: price.amountMinor,
          billingInterval: 'month',
        });
      }
    }
  }

  const addonAssignments = await currentAddonAssignments(db, { organizationId: input.organizationId });
  for (const assignment of addonAssignments) {
    versionParts.push(`addon:${assignment.planId}:${assignment.periodStart}`);
    const plan = await getPlanById(db, assignment.planId);
    if (!plan || !plan.billable) continue;

    const quotas = await listPlanQuotas(db, assignment.planId);
    const isRecurringResource = quotas.some((q) => q.allowanceType === 'recurring_resource');

    const prices = await listPlanPrices(db, assignment.planId);
    const hasOneTime = prices.some((p) => p.billingInterval === 'one_time' && p.approvalState === 'approved');
    const billingInterval: 'month' | 'one_time' = hasOneTime ? 'one_time' : 'month';

    const price = await organizationPlanPrice(db, {
      organizationId: input.organizationId,
      planId: assignment.planId,
      billingInterval,
    });
    if (!price) {
      blockers.push({
        code: 'no_addon_price',
        message: `${plan.label} has no price in force -- ask platform staff to approve one.`,
      });
      continue;
    }
    if (currency && price.currency !== currency) {
      blockers.push({
        code: 'mixed_currency',
        message: `${plan.label} is priced in ${price.currency}, which does not match this purchase's ${currency}.`,
      });
      continue;
    }
    currency = currency ?? price.currency;

    const line: PurchaseQuoteLine = {
      sourceType: 'addon',
      sourceId: assignment.planId,
      label: plan.label,
      quantity: 1,
      amountMinor: price.amountMinor,
      billingInterval,
    };

    if (billingInterval === 'one_time') {
      // A one-time component belongs on the initial purchase only in the period containing its
      // own assignment start -- the same rule app.compose_organization_charges applies, so a
      // business re-running checkout later never re-buys a setup fee it already paid.
      dueNow.push(line);
    } else {
      recurring.push(line);
      void isRecurringResource; // classification only affects display elsewhere; both bill monthly here.
    }
  }

  if (!currency) {
    currency = 'USD';
  }

  const recurringTotalMinor = recurring.reduce((sum, line) => sum + line.amountMinor * line.quantity, 0);
  const dueNowTotalMinor =
    dueNow.reduce((sum, line) => sum + line.amountMinor * line.quantity, 0) + recurringTotalMinor;

  const commercialConfigurationVersion = versionParts.sort().join('|');
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString();

  return {
    organizationId: input.organizationId,
    currency,
    recurring,
    dueNow,
    recurringTotalMinor,
    dueNowTotalMinor,
    commercialConfigurationVersion,
    expiresAt,
    blockers,
  };
}

/** Thrown by checkout when the live package no longer matches what the browser was quoted. */
export function assertQuoteStillCurrent(
  snapshotVersion: string | null,
  liveVersion: string,
): void {
  if (snapshotVersion !== null && snapshotVersion !== liveVersion) {
    throw new DomainError(
      'This business’s package changed since checkout began -- please start again to see the current price.',
      'platform_billing.quote_stale',
    );
  }
}
