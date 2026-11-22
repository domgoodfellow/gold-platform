import type { Db } from '@/lib/db/types';
import { getTenant, type Tenant } from '@/lib/domain/platform/tenants';
import { listOrganizationTerms, moduleCommercialState, type CommercialTerm, type ModuleCommercialState } from '@/lib/domain/commercial/terms';
import { listProducts, type Product } from '@/lib/domain/commercial/catalogue';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts, type CatalogFeature, type CatalogModule, type CatalogProduct } from '@/lib/domain/catalogue/catalogue';
import { listPlans, listPlanPrices, listPlanQuotas, currentPlanPrice, type Plan, type PlanPrice, type PlanQuota } from '@/lib/domain/catalogue/plans';
import {
  currentAddonAssignments,
  currentPlanAssignment,
  listOrganizationPlanAgreements,
  listOrganizationPlanAssignments,
  listOrganizationPlanQuotaOverrides,
  organizationEffectiveQuotas,
  organizationPlanPrice,
  organizationResolvedFeatureStates,
  type PlanAgreement,
  type PlanAssignment,
  type PlanQuotaOverride,
  type ResolvedFeatureState,
} from '@/lib/domain/catalogue/organization-plans';
import {
  organizationAllowanceStates,
  type OrganizationAllowanceState,
} from '@/lib/domain/commercial/allowances';
import { listCurrentPlanAssignments } from '@/lib/domain/catalogue/organization-plans';
import { listTenantsByIds } from '@/lib/domain/platform/tenants';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import { getOrganizationServiceAccess, type ServiceAccess } from '@/lib/domain/platform-billing/service-access';
import {
  listOrganizationSubscriptions,
  listSubscriptionItems,
  listSubscriptionsForOrganization,
  type OrganizationSubscription,
  type OrganizationSubscriptionItem,
} from '@/lib/domain/platform-billing/subscriptions';
import { listRecentPlatformBillingEvents } from '@/lib/domain/platform-billing/webhook-events';
import { customerForTenant } from '@/lib/domain/customers/client-tenants';

/**
 * GildOps' Finance → Subscriptions (ADR-057): what each business GildOps serves subscribes to,
 * at what price, what that switches on and what the billing provider holds. One compositional
 * read model over the canonical Plan/Add-on functions (`organization-plans.ts`, `plans.ts`), the
 * legacy per-product terms (`commercial/terms.ts`) and the billing provider's copy
 * (`platform-billing/subscriptions.ts`). Every read runs as the signed-in member, so the database
 * decides: `subscription.read` in GildOps' operating organization, never platform authority.
 * Composes; it introduces no second calculation — `effective` below is always
 * `organizationPlanPrice()`'s own result, never re-derived.
 */

export type ComponentPrice = {
  planId: string;
  planKey: string;
  label: string;
  kind: 'plan' | 'addon';
  /** The Plan's own catalogue price, ignoring any agreement — from `price_book_item_prices` alone. */
  standard: { amountMinor: number; currency: string } | null;
  /** The currently-effective negotiated price, if this organization has one. */
  agreement: { amountMinor: number; currency: string; effectiveFrom: string; effectiveTo: string | null } | null;
  /** What this organization actually pays right now — `organizationPlanPrice()`'s own answer, never re-derived. */
  effective: { amountMinor: number; currency: string; source: 'agreement' | 'standard' } | null;
};

export type OrganizationAllowance = {
  allowanceKey: string;
  label: string;
  unit: string;
  period: string;
  hardLimit: number | null;
  overageBehavior: PlanQuota['overageBehavior'] | null;
  sourcePlanId: string;
  sourcePlanKey: string;
  sourcePlanLabel: string;
  included: {
    planDefault: number | null;
    override: number | null;
    effective: number;
  };
  overridden: boolean;
  /**
   * What is actually being consumed against this allowance right now — the resolver's own
   * answer, the same one `app.record_usage` and `open_call` enforce against. Null for a
   * configured allowance the runtime resolver returns no state for.
   *
   * **Configuration and consumption stay separate concepts.** The fields above are what was
   * agreed; this is what is happening. They are shown side by side and never merged into one
   * number, because "1,500 SMS included" and "1,082 used" answer different questions.
   */
  runtime: OrganizationAllowanceState | null;
};

export type CommercialFeatureGroup = {
  product: CatalogProduct;
  modules: {
    module: CatalogModule;
    features: { feature: CatalogFeature; resolved: ResolvedFeatureState | null }[];
  }[];
};

async function componentPrice(
  db: Db,
  input: { organizationId: string; currency: string },
  assignment: PlanAssignment,
  plan: Plan | null,
): Promise<ComponentPrice> {
  const [prices, effective] = await Promise.all([
    listPlanPrices(db, assignment.planId),
    organizationPlanPrice(db, { organizationId: input.organizationId, planId: assignment.planId }),
  ]);
  const standardPrice = currentPlanPrice(prices, { currency: input.currency, billingInterval: 'month' });
  const agreements = await listOrganizationPlanAgreements(db, { organizationId: input.organizationId, planId: assignment.planId });
  const today = new Date().toISOString();
  const currentAgreement =
    agreements.find((agreement) => agreement.effectiveFrom <= today && (agreement.effectiveTo === null || agreement.effectiveTo >= today)) ?? null;

  return {
    planId: assignment.planId,
    planKey: plan?.key ?? assignment.planId,
    label: plan?.label ?? assignment.planId,
    kind: assignment.planKind,
    standard: standardPrice ? { amountMinor: standardPrice.amountMinor, currency: standardPrice.currency } : null,
    agreement: currentAgreement
      ? { amountMinor: currentAgreement.amountMinor, currency: currentAgreement.currency, effectiveFrom: currentAgreement.effectiveFrom, effectiveTo: currentAgreement.effectiveTo }
      : null,
    effective: effective ? { amountMinor: effective.amountMinor, currency: effective.currency, source: effective.source } : null,
  };
}

/** Sums every component's effective price, only when every component is priced and every price shares one currency — an absent or mixed-currency total is `null` (`Unknown / incomplete`), never `$0` or a guess. */
function recurringTotal(components: readonly ComponentPrice[]): { amountMinor: number; currency: string } | null {
  if (components.length === 0) return null;
  const currencies = new Set(components.map((component) => component.effective?.currency).filter((currency): currency is string => Boolean(currency)));
  if (currencies.size !== 1 || components.some((component) => !component.effective)) return null;
  const currency = [...currencies][0];
  return { amountMinor: components.reduce((sum, component) => sum + (component.effective?.amountMinor ?? 0), 0), currency };
}

async function buildAllowances(
  db: Db,
  input: { organizationId: string },
  planById: Map<string, Plan>,
): Promise<OrganizationAllowance[]> {
  // The raw contributions (one row per contributing Plan, with the override applied) stay the
  // provenance this screen is for; the resolved runtime state is read alongside them rather than
  // replacing them, and neither is derived from the other here.
  const [effective, runtimeStates] = await Promise.all([
    organizationEffectiveQuotas(db, { organizationId: input.organizationId }),
    organizationAllowanceStates(db, { organizationId: input.organizationId }),
  ]);
  const runtimeByKey = new Map(runtimeStates.map((state) => [state.allowanceKey, state]));
  const planByKey = new Map([...planById.values()].map((plan) => [plan.key, plan]));
  const planIds = [...new Set(effective.map((quota) => planByKey.get(quota.planKey)?.id).filter((id): id is string => Boolean(id)))];
  const quotasByPlan = new Map(await Promise.all(planIds.map(async (planId) => [planId, await listPlanQuotas(db, planId)] as const)));

  return effective.map((quota) => {
    const plan = planByKey.get(quota.planKey);
    const planQuota = plan ? quotasByPlan.get(plan.id)?.find((candidate) => candidate.allowanceKey === quota.allowanceKey) : undefined;
    return {
      allowanceKey: quota.allowanceKey,
      label: quota.label,
      unit: quota.unit,
      period: quota.period,
      hardLimit: quota.hardLimit,
      overageBehavior: planQuota?.overageBehavior ?? null,
      sourcePlanId: plan?.id ?? '',
      sourcePlanKey: quota.planKey,
      sourcePlanLabel: plan?.label ?? quota.planKey,
      included: {
        planDefault: planQuota?.includedQuantity ?? null,
        override: quota.overridden ? quota.includedQuantity : null,
        effective: quota.includedQuantity,
      },
      overridden: quota.overridden,
      runtime: runtimeByKey.get(quota.allowanceKey) ?? null,
    };
  });
}

function buildFeatureGroups(
  catalogProducts: readonly CatalogProduct[],
  catalogModules: readonly CatalogModule[],
  catalogFeatures: readonly CatalogFeature[],
  resolvedByFeature: Map<string, ResolvedFeatureState>,
): CommercialFeatureGroup[] {
  const modulesByProduct = new Map<string, CatalogModule[]>();
  for (const catalogModule of catalogModules) {
    modulesByProduct.set(catalogModule.productId, [...(modulesByProduct.get(catalogModule.productId) ?? []), catalogModule]);
  }
  const featuresByModule = new Map<string, CatalogFeature[]>();
  for (const feature of catalogFeatures) {
    featuresByModule.set(feature.moduleId, [...(featuresByModule.get(feature.moduleId) ?? []), feature]);
  }

  return [...catalogProducts]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((product) => ({
      product,
      modules: [...(modulesByProduct.get(product.id) ?? [])]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((catalogModule) => ({
          module: catalogModule,
          features: [...(featuresByModule.get(catalogModule.id) ?? [])]
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((feature) => ({ feature, resolved: resolvedByFeature.get(feature.id) ?? null })),
        }))
        .filter((entry) => entry.features.length > 0),
    }))
    .filter((entry) => entry.modules.length > 0);
}

/** One row of GildOps' Subscriptions: a business it serves, its plan and price, and the billing provider's state. */
export type SubscriptionRow = {
  tenant: Tenant;
  plan: Plan | null;
  addonCount: number;
  since: string | null;
  effective: { amountMinor: number; currency: string; source: 'agreement' | 'standard' } | null;
  billing: OrganizationSubscription | null;
  access: ServiceAccess;
};

/**
 * Every business with a current plan or a billing-provider subscription. Prices come from
 * `organizationPlanPrice`, service access from the resolver the business's own guard runs.
 */
export async function loadSubscriptions(db: Db): Promise<SubscriptionRow[]> {
  const [assignments, billing, plans] = await Promise.all([listCurrentPlanAssignments(db), listOrganizationSubscriptions(db), listPlans(db)]);
  const environment = platformBillingEnvironment();
  const ids = [...new Set([...assignments.map((row) => row.organizationId), ...billing.map((row) => row.organizationId)])];
  const tenants = await listTenantsByIds(db, ids);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  return Promise.all(tenants.map(async (tenant) => {
    const held = assignments.filter((row) => row.organizationId === tenant.id);
    const base = held.find((row) => row.planKind === 'plan') ?? null;
    const [effective, access] = await Promise.all([
      base ? organizationPlanPrice(db, { organizationId: tenant.id, planId: base.planId }) : Promise.resolve(null),
      getOrganizationServiceAccess(db, { organizationId: tenant.id, environment, operationalState: tenant.operationalState }),
    ]);
    return {
      tenant,
      plan: base ? (planById.get(base.planId) ?? null) : null,
      addonCount: held.filter((row) => row.planKind === 'addon').length,
      since: base?.periodStart ?? null,
      effective: effective ? { amountMinor: effective.amountMinor, currency: effective.currency, source: effective.source } : null,
      billing: billing.find((row) => row.organizationId === tenant.id && row.environment === environment) ?? null,
      access,
    };
  })).then((rows) => rows.sort((a, b) => a.tenant.name.localeCompare(b.tenant.name)));
}

/** The billing provider's copy of one business's subscription: what it holds, its items, and the deliveries that changed it. */
async function loadBilling(db: Db, organizationId: string) {
  const environment = platformBillingEnvironment();
  const subscriptions = (await listSubscriptionsForOrganization(db, { organizationId })).filter((row) => row.environment === environment);
  const [items, events] = await Promise.all([
    listSubscriptionItems(db, subscriptions),
    listRecentPlatformBillingEvents(db, { limit: 10, organizationId }),
  ]);
  return { environment, subscription: subscriptions[0] ?? null, items: items as OrganizationSubscriptionItem[], events };
}

/** One business's subscription record in GildOps' Finance, keyed by the business it serves. */
export async function loadSubscription(db: Db, input: { sellerId: string; subscriberId: string }) {
  const organizationId = input.subscriberId;
  const tenant = await getTenant(db, organizationId);
  if (!tenant) return null;
  const environment = platformBillingEnvironment();
  const [billing, access, customerId] = await Promise.all([
    loadBilling(db, organizationId),
    getOrganizationServiceAccess(db, { organizationId, environment, operationalState: tenant.operationalState }),
    customerForTenant(db, { organizationId: input.sellerId, tenantId: organizationId }),
  ]);

  const [terms, states, products, plans, basePlanAssignment, addonAssignments, resolvedFeatures, agreements, assignmentHistory, quotaOverrides, catalogProducts, catalogModules, catalogFeatures] =
    await Promise.all([
      listOrganizationTerms(db, { organizationId }),
      moduleCommercialState(db, { organizationId }),
      listProducts(db),
      listPlans(db),
      currentPlanAssignment(db, { organizationId }),
      currentAddonAssignments(db, { organizationId }),
      organizationResolvedFeatureStates(db, { organizationId }),
      listOrganizationPlanAgreements(db, { organizationId }),
      listOrganizationPlanAssignments(db, { organizationId }),
      listOrganizationPlanQuotaOverrides(db, { organizationId }),
      listCatalogProducts(db),
      listCatalogModules(db),
      listCatalogFeatures(db),
    ]);

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const resolvedByFeature = new Map(resolvedFeatures.map((feature) => [feature.featureId, feature]));

  const priceInput = { organizationId, currency: tenant.currency };
  const basePlanComponent = basePlanAssignment ? await componentPrice(db, priceInput, basePlanAssignment, planById.get(basePlanAssignment.planId) ?? null) : null;
  const addonComponents = await Promise.all(addonAssignments.map((assignment) => componentPrice(db, priceInput, assignment, planById.get(assignment.planId) ?? null)));
  const recurringComponents = basePlanComponent ? [basePlanComponent, ...addonComponents] : addonComponents;

  const allowances = await buildAllowances(db, { organizationId }, planById);
  const features = buildFeatureGroups(catalogProducts, catalogModules, catalogFeatures, resolvedByFeature);

  return {
    tenant,
    billing,
    access,
    customerId,
    basePlan: { assignment: basePlanAssignment, plan: basePlanAssignment ? (planById.get(basePlanAssignment.planId) ?? null) : null },
    addons: addonAssignments.map((assignment) => ({ assignment, plan: planById.get(assignment.planId) ?? null })),
    pricing: basePlanComponent
      ? { standard: basePlanComponent.standard, agreement: basePlanComponent.agreement, effective: basePlanComponent.effective }
      : { standard: null, agreement: null, effective: null },
    recurringComponents,
    recurringTotal: recurringTotal(recurringComponents),
    features,
    allowances,
    agreements,
    assignmentHistory,
    quotaOverrideHistory: quotaOverrides,
    legacy: { hasLegacyTerms: terms.length > 0, terms },
    // Kept for the legacy-compatibility surfaces (the wanted∩paid entitlement state, and the form that records
    // a standalone term) — not part of the canonical commercial account shape above.
    states,
    products,
    plans,
  };
}

export type SubscriptionModel = NonNullable<Awaited<ReturnType<typeof loadSubscription>>>;
export type { Tenant, CommercialTerm, ModuleCommercialState, Product, PlanAgreement, PlanAssignment, PlanQuotaOverride, PlanPrice };
