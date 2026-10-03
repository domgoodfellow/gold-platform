import type { Db } from '@/lib/db/types';
import { communicationsAccount } from '@/lib/domain/communications/credits';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms } from '@/lib/domain/commercial/terms';
import { listUsageEvents } from '@/lib/domain/commercial/usage';
import { organizationAllowanceStates } from '@/lib/domain/commercial/allowances';
import { listMeters } from '@/lib/domain/commercial/catalogue';
import { listPlans, listPlanPrices } from '@/lib/domain/catalogue/plans';
import { currentAddonAssignments, currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import { getOrganizationSubscription } from '@/lib/domain/platform-billing/subscriptions';
import { buildOrganizationPurchaseQuote, type PurchaseQuote } from '@/lib/domain/platform-billing/quote';

/**
 * What this business is entitled to use, how much of it is left, what it has used and what that
 * cost — never what it cost GildOps, and never a margin (`constraints.md` D43).
 *
 * **Allowances come from the runtime resolver, not from the raw quota rows.** The screen used to
 * render `organizationEffectiveQuotas`, which is one row per contributing Plan with no window and
 * no consumption — so a business holding a base Plan and an Add-on saw the same allowance twice
 * and neither number told it anything about what was left. `organizationAllowanceStates` is the
 * one answer, the same one `app.record_usage` and `open_call` enforce against.
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
  const [subscription, basePlanPrices] = await Promise.all([
    billingProvider ? getOrganizationSubscription(db, { organizationId }) : Promise.resolve(null),
    basePlan ? listPlanPrices(db, basePlan.id) : Promise.resolve([]),
  ]);
  const subscribablePrice = input.currency
    ? basePlanPrices.find((price) => price.approvalState === 'approved' && price.currency === input.currency)
    : undefined;
  // The review-before-pay quote (work order C §5) -- only built when there is actually a purchase
  // in front of this business: no provider configured, or already subscribed, means nothing to
  // review.
  const quote: PurchaseQuote | null =
    billingProvider && !subscription && basePlan && subscribablePrice
      ? await buildOrganizationPurchaseQuote(db, { organizationId })
      : null;
  return {
    terms, products, usage, account, basePlanAssignment, addonAssignments, allowances, basePlan, addonPlans,
    meterLabel: new Map(meters.map((meter) => [meter.id, meter.label])),
    productLabel: new Map(products.map((product) => [product.key, product.label])), billingProvider, subscription,
    subscribablePrice, quote,
    canManageBilling: input.capabilities.includes('billing.manage'),
  };
}

export type PlanUsageModel = Awaited<ReturnType<typeof loadPlanUsage>>;
