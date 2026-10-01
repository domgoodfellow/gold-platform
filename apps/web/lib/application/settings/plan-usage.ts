import type { Db } from '@/lib/db/types';
import { communicationsAccount } from '@/lib/domain/communications/credits';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms } from '@/lib/domain/commercial/terms';
import { listUsageEvents } from '@/lib/domain/commercial/usage';
import { listPlans, listPlanPrices } from '@/lib/domain/catalogue/plans';
import { currentAddonAssignments, currentPlanAssignment, organizationEffectiveQuotas } from '@/lib/domain/catalogue/organization-plans';
import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import { getOrganizationSubscription } from '@/lib/domain/platform-billing/subscriptions';

export async function loadPlanUsage(db: Db, input: { organizationId: string; currency: string | null; capabilities: string[] }) {
  const { organizationId } = input;
  const [terms, products, usage, account, basePlanAssignment, addonAssignments, quotas, plans] = await Promise.all([
    listOrganizationTerms(db, { organizationId }), listProducts(db), listUsageEvents(db, { organizationId, limit: 50 }),
    communicationsAccount(db, { organizationId, currency: input.currency }), currentPlanAssignment(db, { organizationId }),
    currentAddonAssignments(db, { organizationId }), organizationEffectiveQuotas(db, { organizationId }), listPlans(db),
  ]);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const basePlan = basePlanAssignment ? (planById.get(basePlanAssignment.planId) ?? null) : null;
  const addonPlans = addonAssignments.map((assignment) => planById.get(assignment.planId) ?? null);
  const billingProvider = await platformBillingProvider();
  const [subscription, basePlanPrices] = await Promise.all([
    billingProvider ? getOrganizationSubscription(db, { organizationId }) : Promise.resolve(null),
    basePlan ? listPlanPrices(db, basePlan.id) : Promise.resolve([]),
  ]);
  return {
    terms, products, usage, account, basePlanAssignment, addonAssignments, quotas, basePlan, addonPlans,
    productLabel: new Map(products.map((product) => [product.key, product.label])), billingProvider, subscription,
    subscribablePrice: input.currency ? basePlanPrices.find((price) => price.approvalState === 'approved' && price.currency === input.currency) : undefined,
    canManageBilling: input.capabilities.includes('billing.manage'),
  };
}

export type PlanUsageModel = Awaited<ReturnType<typeof loadPlanUsage>>;
