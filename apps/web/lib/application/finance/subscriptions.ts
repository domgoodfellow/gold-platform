import type { Db } from '@/lib/db/types';
import { getTenant, type Tenant } from '@/lib/domain/platform/tenants';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts, type CatalogFeature, type CatalogModule, type CatalogProduct } from '@/lib/domain/catalogue/catalogue';
import { listPlans, listPlanQuotas, type Plan, type PlanQuota } from '@/lib/domain/catalogue/plans';
import {
  listOrganizationPlanQuotaOverrides,
  organizationEffectiveQuotas,
  organizationResolvedFeatureStates,
  type PlanQuotaOverride,
  type ResolvedFeatureState,
} from '@/lib/domain/catalogue/organization-plans';
import { organizationAllowanceStates, type OrganizationAllowanceState } from '@/lib/domain/commercial/allowances';
import { listMeters, listProducts, type Meter, type Product } from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms, type CommercialTerm } from '@/lib/domain/commercial/terms';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import { getOrganizationServiceAccess, type ServiceAccess } from '@/lib/domain/platform-billing/service-access';
import { listSubscriptionItems, listSubscriptionsForOrganization, type OrganizationSubscriptionItem } from '@/lib/domain/platform-billing/subscriptions';
import { listRecentPlatformBillingEvents } from '@/lib/domain/platform-billing/webhook-events';
import { invoiceStanding, listInvoices, type Invoice } from '@/lib/domain/billing/invoices';
import { listItemAddons, listItemPrices, listRecurringItems, type ItemPrice, type RecurringItem } from '@/lib/domain/pricing/recurring-items';
import { fromDatabaseError } from '@/lib/domain/errors';
import {
  getSubscription,
  lineInForce,
  listAgreedPrices,
  listAgreedUsagePrices,
  listSubscriptionLines,
  listSubscriptions,
  recurringAmount,
  subscriptionLinePrices,
  subscriptionStatus,
  todayIso,
  type AgreedPrice,
  type AgreedUsagePrice,
  type LinePrice,
  type Subscription,
  type SubscriptionLine,
  type SubscriptionStatus,
} from '@/lib/domain/subscriptions/subscriptions';

/**
 * Finance → Subscriptions (ADR-057): every subscription a business keeps with its own customers,
 * read through the shared subscription records and priced by the database's one rule. Every read
 * runs as the signed-in member, so the database decides who sees what.
 *
 * A subscription whose lines sell platform plans, to a customer linked to a provisioned business,
 * also shows that business's entitlements: what its plans switch on, its allowances, the billing
 * provider's copy and whether service is available. That part is read only where it exists; the
 * subscription itself is the same record every business keeps.
 */

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
   * What is being consumed against this allowance now: the resolver's own answer, the same one
   * `app.record_usage` enforces. Shown beside what was agreed, never merged into one number.
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

async function buildAllowances(db: Db, input: { organizationId: string }, planById: Map<string, Plan>): Promise<OrganizationAllowance[]> {
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

type Customer = { id: string; name: string };

async function customerNames(db: Db, organizationId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from('contacts').select('id, name').eq('organization_id', organizationId).in('id', ids);
  if (error) throw fromDatabaseError(error, 'subscriptions.customers_failed');
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/** One row of Finance → Subscriptions. */
export type SubscriptionRow = {
  subscription: Subscription;
  status: SubscriptionStatus;
  customer: Customer;
  /** What it is for today (or first, before it starts): the primary item's name. */
  itemName: string | null;
  addonCount: number;
  /** The recurring amount per billing interval of the lines in force; null when unknown. */
  amount: { amountMinor: number; currency: string } | null;
  agreed: boolean;
};

export async function loadSubscriptions(db: Db, input: { organizationId: string }): Promise<SubscriptionRow[]> {
  const subscriptions = await listSubscriptions(db, { organizationId: input.organizationId });
  const [lines, items, names] = await Promise.all([
    listSubscriptionLines(db, { organizationId: input.organizationId, subscriptionIds: subscriptions.map((row) => row.id) }),
    listRecurringItems(db, { organizationId: input.organizationId }),
    customerNames(db, input.organizationId, [...new Set(subscriptions.map((row) => row.customerId))]),
  ]);
  const itemName = new Map(items.map((item) => [item.id, item.name]));
  const prices = await Promise.all(subscriptions.map((row) => subscriptionLinePrices(db, { subscriptionId: row.id })));
  const today = todayIso();
  return subscriptions.map((subscription, index) => {
    const own = lines.filter((line) => line.subscriptionId === subscription.id);
    const status = subscriptionStatus(subscription, today);
    const day = status === 'scheduled' ? subscription.startsOn : today;
    const primary = own.find((line) => line.role === 'primary' && lineInForce(line, day)) ?? own.find((line) => line.role === 'primary') ?? null;
    const inForce = own.filter((line) => lineInForce(line, day));
    return {
      subscription,
      status,
      customer: { id: subscription.customerId, name: names.get(subscription.customerId) ?? 'Customer' },
      itemName: primary ? (itemName.get(primary.itemId) ?? null) : null,
      addonCount: inForce.filter((line) => line.role === 'addon').length,
      amount: status === 'ended' ? null : recurringAmount(own, prices[index], day),
      agreed: prices[index].some((price) => price.source === 'agreed' && inForce.some((line) => line.id === price.lineId)),
    };
  }).sort((a, b) => a.customer.name.localeCompare(b.customer.name) || b.subscription.startsOn.localeCompare(a.subscription.startsOn));
}

/** One line of a subscription as its record shows it. */
export type SubscriptionLineView = SubscriptionLine & {
  item: Pick<RecurringItem, 'id' | 'name' | 'unit' | 'plan'> | null;
  /** What it pays now, by the database's rule. */
  price: LinePrice | null;
  /** The item's list price now in the subscription's terms. */
  listPrice: Pick<ItemPrice, 'amountMinor' | 'currency' | 'billingInterval'> | null;
  agreedPrices: AgreedPrice[];
  inForce: boolean;
};

/** What a provisioned business holds through this subscription: the platform side, read only where it exists. */
export type PlatformEntitlements = {
  tenant: Tenant;
  access: ServiceAccess;
  billing: Awaited<ReturnType<typeof loadBilling>>;
  allowances: OrganizationAllowance[];
  features: CommercialFeatureGroup[];
  quotaOverrides: PlanQuotaOverride[];
  /** The plan the primary line in force sells. */
  basePlanId: string | null;
  plans: Plan[];
  meters: Meter[];
  agreedUsagePrices: AgreedUsagePrice[];
  /** Per-product terms from before plans: still what makes some modules usable for an older business. */
  terms: CommercialTerm[];
  products: Product[];
};

/** The business a subscription's lines provision, if any: each plan assignment names the line it carries out. */
async function provisionedTenant(db: Db, lineIds: string[]): Promise<string | null> {
  if (lineIds.length === 0) return null;
  const { data, error } = await db.from('organization_plan_assignments').select('organization_id').in('subscription_line_id', lineIds).limit(1).maybeSingle();
  if (error) throw fromDatabaseError(error, 'subscriptions.tenant_failed');
  return data?.organization_id ?? null;
}

async function loadPlatformEntitlements(db: Db, input: { organizationId: string; tenantId: string; lines: SubscriptionLine[] }): Promise<PlatformEntitlements | null> {
  const tenant = await getTenant(db, input.tenantId);
  if (!tenant) return null;
  const environment = platformBillingEnvironment();
  const [access, billing, plans, resolvedFeatures, quotaOverrides, catalogProducts, catalogModules, catalogFeatures, meters, agreedUsagePrices, terms, products] = await Promise.all([
    getOrganizationServiceAccess(db, { organizationId: tenant.id, environment, operationalState: tenant.operationalState }),
    loadBilling(db, tenant.id),
    listPlans(db),
    organizationResolvedFeatureStates(db, { organizationId: tenant.id }),
    listOrganizationPlanQuotaOverrides(db, { organizationId: tenant.id }),
    listCatalogProducts(db),
    listCatalogModules(db),
    listCatalogFeatures(db),
    listMeters(db),
    listAgreedUsagePrices(db, { organizationId: input.organizationId, lineIds: input.lines.map((line) => line.id) }),
    listOrganizationTerms(db, { organizationId: tenant.id }),
    listProducts(db),
  ]);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const allowances = await buildAllowances(db, { organizationId: tenant.id }, planById);
  const features = buildFeatureGroups(catalogProducts, catalogModules, catalogFeatures, new Map(resolvedFeatures.map((feature) => [feature.featureId, feature])));
  const primary = input.lines.find((line) => line.role === 'primary' && lineInForce(line));
  const basePlanId = primary ? (plans.find((plan) => plan.priceBookItemId === primary.itemId)?.id ?? null) : null;
  return { tenant, access, billing, allowances, features, quotaOverrides, basePlanId, plans, meters, agreedUsagePrices, terms, products };
}

/** One subscription's record: its terms, lines and prices, its invoices and, where it provisions a business, that business's entitlements. */
export async function loadSubscription(db: Db, input: { organizationId: string; subscriptionId: string }) {
  const subscription = await getSubscription(db, input);
  if (!subscription) return null;
  const [lines, items, names, invoices, prices] = await Promise.all([
    listSubscriptionLines(db, { organizationId: input.organizationId, subscriptionIds: [subscription.id] }),
    listRecurringItems(db, { organizationId: input.organizationId }),
    customerNames(db, input.organizationId, [subscription.customerId]),
    listInvoices(db, { organizationId: input.organizationId, subscriptionId: subscription.id }),
    subscriptionLinePrices(db, { subscriptionId: subscription.id }),
  ]);
  const [agreedPrices, listPrices, addons, tenantId] = await Promise.all([
    listAgreedPrices(db, { organizationId: input.organizationId, lineIds: lines.map((line) => line.id) }),
    listItemPrices(db, { organizationId: input.organizationId, itemIds: items.map((item) => item.id) }),
    listItemAddons(db, { organizationId: input.organizationId, itemIds: items.map((item) => item.id) }),
    provisionedTenant(db, lines.map((line) => line.id)),
  ]);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const now = new Date().toISOString();
  const currentList = (itemId: string) => listPrices
    .filter((price) => price.itemId === itemId && price.currency === subscription.currency && price.approvalState === 'approved'
      && (price.billingInterval === subscription.billingInterval || price.billingInterval === 'one_time')
      && price.effectiveFrom <= now && (!price.effectiveTo || price.effectiveTo > now))
    .sort((a, b) => Number(b.billingInterval === subscription.billingInterval) - Number(a.billingInterval === subscription.billingInterval) || b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
  const today = todayIso();
  const lineViews: SubscriptionLineView[] = lines.map((line) => {
    const item = itemById.get(line.itemId);
    return {
      ...line,
      item: item ? { id: item.id, name: item.name, unit: item.unit, plan: item.plan } : null,
      price: prices.find((price) => price.lineId === line.id) ?? null,
      listPrice: currentList(line.itemId),
      agreedPrices: agreedPrices.filter((price) => price.lineId === line.id),
      inForce: lineInForce(line, today),
    };
  });
  const primary = lineViews.find((line) => line.role === 'primary' && line.inForce) ?? null;
  const sellable = items.filter((item) => item.saleStatus !== 'archived');
  return {
    subscription,
    status: subscriptionStatus(subscription, today),
    customer: { id: subscription.customerId, name: names.get(subscription.customerId) ?? 'Customer' } satisfies Customer,
    lines: lineViews,
    amount: recurringAmount(lines, prices, today),
    invoices: invoices.map((invoice: Invoice) => ({ invoice, standing: invoiceStanding(invoice) })),
    /** Recurring items it can change to, and the add-ons of what it is for now. */
    options: {
      items: sellable.filter((item) => item.plan?.kind !== 'addon' && item.id !== primary?.itemId).map((item) => ({ value: item.id, label: item.name })),
      addons: primary
        ? addons.filter((addon) => addon.itemId === primary.itemId).flatMap((addon) => {
            const item = itemById.get(addon.addonItemId);
            return item && item.saleStatus !== 'archived' ? [{ value: item.id, label: item.name }] : [];
          })
        : [],
    },
    platform: tenantId ? await loadPlatformEntitlements(db, { organizationId: input.organizationId, tenantId, lines }) : null,
  };
}

export type SubscriptionModel = NonNullable<Awaited<ReturnType<typeof loadSubscription>>>;

/** What the New subscription form offers: every recurring item this business still sells, offered publicly or not (an unlisted item is sold by agreement). */
export async function loadSubscriptionOptions(db: Db, input: { organizationId: string }) {
  const items = await listRecurringItems(db, { organizationId: input.organizationId });
  return items.filter((item) => item.saleStatus !== 'archived' && item.plan?.kind !== 'addon').map((item) => ({ value: item.id, label: item.name }));
}

export type { Tenant, PlanQuota, CatalogFeature, CatalogModule, CatalogProduct, ResolvedFeatureState, OrganizationAllowanceState };
