import { createHash } from 'node:crypto';
import type { Db } from '@/lib/db/types';
import { getPlanById, listPlanPrices } from '@/lib/domain/catalogue/plans';
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

/** Which table decided a line's price. The id beside it is that table's own row. */
export type PriceSourceDomain = 'catalogue.plan_price' | 'catalogue.plan_agreement';

export type PurchaseQuoteLine = {
  sourceType: 'plan' | 'addon';
  /** The Plan or Add-on's own `platform_plans.id`. */
  sourceId: string;
  /** The `organization_plan_assignments.id` that put this Plan or Add-on in the package. Also the
   * identity a one-time obligation is recorded against, so it is what "already purchased" asks. */
  assignmentId: string;
  label: string;
  quantity: number;
  amountMinor: number;
  billingInterval: 'month' | 'year' | 'one_time';
  /** The exact record the price came from: `platform_plan_prices.id` for a standard price,
   * `organization_plan_agreements.id` for a negotiated one. Never organization + Plan + interval,
   * which a later agreement would also match. */
  priceSourceDomain: PriceSourceDomain;
  priceSourceId: string;
};

export type PurchaseQuoteBlocker = { code: string; message: string };

export type PurchaseQuote = {
  organizationId: string;
  currency: string;
  recurring: PurchaseQuoteLine[];
  dueNow: PurchaseQuoteLine[];
  recurringTotalMinor: number;
  dueNowTotalMinor: number;
  /**
   * An opaque, server-derived fingerprint of everything commercially consequential in this quote
   * (see `quoteReviewVersion`). The review screen carries it back on Subscribe; a rebuilt quote
   * with a different one means the customer reviewed something that is no longer what they would
   * buy. The browser sends this and nothing monetary.
   */
  reviewVersion: string;
  expiresAt: string;
  blockers: PurchaseQuoteBlocker[];
};

const QUOTE_TTL_MINUTES = 30;

/**
 * The fingerprint of what a customer reviews: the organization, the currency, and for every line
 * the Plan, its assignment, the exact price record, the amount, interval, quantity and whether it
 * is recurring or due once. Anything that could change what the customer pays, or what they are
 * paying for, changes it; nothing that merely passes time (the expiry) does.
 */
function quoteReviewVersion(quote: Omit<PurchaseQuote, 'reviewVersion' | 'expiresAt'>): string {
  const lineParts = (classification: 'recurring' | 'due_now', lines: readonly PurchaseQuoteLine[]) =>
    lines.map((line) => [
      classification,
      line.sourceType,
      line.sourceId,
      line.assignmentId,
      line.priceSourceDomain,
      line.priceSourceId,
      line.amountMinor,
      line.billingInterval,
      line.quantity,
    ]);
  const canonical = JSON.stringify({
    organizationId: quote.organizationId,
    currency: quote.currency,
    lines: [...lineParts('recurring', quote.recurring), ...lineParts('due_now', quote.dueNow)].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
    blockers: quote.blockers.map((blocker) => blocker.code).sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Which of these Add-on assignments have already had their one-time fee bought and frozen. The
 * canonical history is `organization_charge_components`: a `one_time_service` component recorded
 * against an assignment and finalized is a fee that has been charged, and finalizing is the one
 * act that makes it history (it can no longer be rewritten). A current assignment alone says
 * nothing about that -- a business that cancels and subscribes again still holds the assignment.
 * A new assignment is a new source record, so its fee is owed afresh.
 */
async function purchasedOneTimeAssignmentIds(
  db: Db,
  input: { organizationId: string; assignmentIds: string[] },
): Promise<Set<string>> {
  if (input.assignmentIds.length === 0) return new Set();
  const { data, error } = await db
    .from('organization_charge_components')
    .select('source_record_id')
    .eq('organization_id', input.organizationId)
    .eq('component_type', 'one_time_service')
    .eq('source_domain', 'catalogue.addon_assignment')
    .in('source_record_id', input.assignmentIds)
    .not('finalized_at', 'is', null);
  if (error) throw new DomainError(error.message, 'platform_billing.one_time_history_failed');
  return new Set((data ?? []).map((row) => row.source_record_id));
}

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

  const baseAssignment = await currentPlanAssignment(db, { organizationId: input.organizationId });
  if (!baseAssignment) {
    blockers.push({
      code: 'no_base_plan',
      message: 'This business has no assigned Plan yet -- ask platform staff to assign one before checkout.',
    });
  }

  let currency: string | null = null;

  if (baseAssignment) {
    const plan = await getPlanById(db, baseAssignment.planId);
    if (!plan || !plan.billable) {
      blockers.push({ code: 'plan_not_billable', message: 'The assigned Plan is not a billable Plan.' });
    } else if (plan.saleStatus === 'archived') {
      blockers.push({ code: 'plan_archived', message: `${plan.label} is archived and can no longer be bought.` });
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
          assignmentId: baseAssignment.id,
          label: plan.label,
          quantity: 1,
          amountMinor: price.amountMinor,
          billingInterval: 'month',
          priceSourceDomain: price.source === 'agreement' ? 'catalogue.plan_agreement' : 'catalogue.plan_price',
          priceSourceId: price.sourceId,
        });
      }
    }
  }

  const addonAssignments = await currentAddonAssignments(db, { organizationId: input.organizationId });
  const purchasedOneTime = await purchasedOneTimeAssignmentIds(db, {
    organizationId: input.organizationId,
    assignmentIds: addonAssignments.map((assignment) => assignment.id),
  });

  for (const assignment of addonAssignments) {
    const plan = await getPlanById(db, assignment.planId);
    if (!plan || !plan.billable) continue;
    if (plan.saleStatus === 'archived') {
      blockers.push({ code: 'addon_archived', message: `${plan.label} is archived and can no longer be bought.` });
      continue;
    }

    const prices = await listPlanPrices(db, assignment.planId);
    const hasOneTime = prices.some((p) => p.billingInterval === 'one_time' && p.approvalState === 'approved');
    const billingInterval: 'month' | 'one_time' = hasOneTime ? 'one_time' : 'month';

    // A one-time fee already bought and frozen is not part of this purchase, and is not a price
    // anyone needs to be in force for.
    if (billingInterval === 'one_time' && purchasedOneTime.has(assignment.id)) continue;

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
      assignmentId: assignment.id,
      label: plan.label,
      quantity: 1,
      amountMinor: price.amountMinor,
      billingInterval,
      priceSourceDomain: price.source === 'agreement' ? 'catalogue.plan_agreement' : 'catalogue.plan_price',
      priceSourceId: price.sourceId,
    };

    if (billingInterval === 'one_time') {
      dueNow.push(line);
    } else {
      recurring.push(line);
    }
  }

  if (!currency) {
    currency = 'USD';
  }

  const recurringTotalMinor = recurring.reduce((sum, line) => sum + line.amountMinor * line.quantity, 0);
  const dueNowTotalMinor =
    dueNow.reduce((sum, line) => sum + line.amountMinor * line.quantity, 0) + recurringTotalMinor;

  const body = {
    organizationId: input.organizationId,
    currency,
    recurring,
    dueNow,
    recurringTotalMinor,
    dueNowTotalMinor,
    blockers,
  };

  return {
    ...body,
    reviewVersion: quoteReviewVersion(body),
    expiresAt: new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString(),
  };
}

/**
 * Refuses a purchase whose rebuilt quote is not the one the customer reviewed. A missing version
 * is the same refusal: a Subscribe that cannot say what it reviewed has reviewed nothing.
 */
export function assertQuoteMatchesReview(reviewedVersion: string | null | undefined, quote: PurchaseQuote): void {
  if (!reviewedVersion || reviewedVersion !== quote.reviewVersion) {
    throw new DomainError(
      'This business’s package or price changed since you reviewed it -- review the current price and try again.',
      'platform_billing.quote_stale',
    );
  }
}
