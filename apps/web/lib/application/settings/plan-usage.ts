import type { Db } from '@/lib/db/types';
import { communicationsAccount } from '@/lib/domain/communications/credits';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms } from '@/lib/domain/commercial/terms';
import { listUsageEvents } from '@/lib/domain/commercial/usage';
import { organizationAllowanceStates } from '@/lib/domain/commercial/allowances';
import { listMeters } from '@/lib/domain/commercial/catalogue';
import { listPlans } from '@/lib/domain/catalogue/plans';
import { currentAddonAssignments, currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import {
  getOrganizationBillingSubscriptionState,
  isEndedSubscription,
} from '@/lib/domain/platform-billing/subscriptions';
import { describeSubscriptionPackage } from '@/lib/domain/platform-billing/subscription-package';
import { buildOrganizationPurchaseQuote, type PurchaseQuote } from '@/lib/domain/platform-billing/quote';

/**
 * What this business is entitled to use, how much of it is left, what it has used and what that
 * cost — never what it cost GildOps, and never a margin (the platform-economics separation, ADR-014).
 *
 * **Allowances come from the runtime resolver, not from the raw quota rows.** The screen used to
 * render `organizationEffectiveQuotas`, which is one row per contributing Plan with no window and
 * no consumption — so a business holding a base Plan and an Add-on saw the same allowance twice
 * and neither number told it anything about what was left. `organizationAllowanceStates` is the
 * one answer, the same one `app.record_usage` and `open_call` enforce against.
 *
 * **Whether Subscribe is offered is the quote's answer, and only the quote's.** A negotiated
 * (agreement) price has no standard Plan price row at all, so a gate on one hid the button for a
 * package checkout could in fact buy. The quote already resolves every line — agreement or
 * standard — and says what blocks it.
 */
export async function loadPlanUsage(db: Db, input: { organizationId: string; currency: string | null; capabilities: string[] }) {
  const { organizationId } = input;
  const [terms, products, usage, account, basePlanAssignment, addonAssignments, allowances, meters, plans] = await Promise.all([
    listOrganizationTerms(db, { organizationId }), listProducts(db), listUsageEvents(db, { organizationId, limit: 50 }),
    communicationsAccount(db, { organizationId, currency: input.currency }), currentPlanAssignment(db, { organizationId }),
    currentAddonAssignments(db, { organizationId }), organizationAllowanceStates(db, { organizationId }),
    listMeters(db), listPlans(db),
  ]);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const basePlan = basePlanAssignment ? (planById.get(basePlanAssignment.planId) ?? null) : null;
  const addonPlans = addonAssignments.map((assignment) => planById.get(assignment.planId) ?? null);
  const billingProvider = await platformBillingProvider();
  const subscriptionState = billingProvider ? await getOrganizationBillingSubscriptionState(db, { organizationId }) : null;
  // An ended subscription is kept as provider history; it is neither one to manage nor a purchase already made.
  const current = subscriptionState && !isEndedSubscription(subscriptionState.subscription) ? subscriptionState : null;
  const subscription = current?.subscription ?? null;
  const subscriptionPackage = current ? describeSubscriptionPackage(current.items, plans) : null;
  // The review-before-pay quote (work order C §5) -- only built when there is actually a purchase
  // in front of this business: no provider configured, or already subscribed, means nothing to
  // review. It is the single authority on whether checkout can proceed.
  const quote: PurchaseQuote | null =
    billingProvider && !subscription && basePlan ? await buildOrganizationPurchaseQuote(db, { organizationId }) : null;
  return {
    terms, products, usage, account, basePlanAssignment, addonAssignments, allowances, basePlan, addonPlans,
    meterLabel: new Map(meters.map((meter) => [meter.id, meter.label])),
    productLabel: new Map(products.map((product) => [product.key, product.label])), billingProvider, subscription,
    subscriptionPackage, quote, canSubscribe: Boolean(quote && quote.blockers.length === 0),
    canManageBilling: input.capabilities.includes('billing.manage'),
  };
}

export type PlanUsageModel = Awaited<ReturnType<typeof loadPlanUsage>>;
