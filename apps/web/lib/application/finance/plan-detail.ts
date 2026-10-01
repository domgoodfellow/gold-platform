import type { Db } from '@/lib/db/types';
import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import { listTenantsByIds } from '@/lib/domain/platform/tenants';
import { listProvisionedPlanPrices } from '@/lib/domain/platform-billing/provisioning';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import {
  getPlan, listPlans, listPlanFeatureGrants, listPlanModuleGrants, listPlanPrices, listPlanOverageRates,
  currentPlanMarginPolicy, listPlanUtilizationAssumptions, listPlanAddonIds, listPlanProductGrants,
  listPlanQuotas, planEntitledFeatureIds,
} from '@/lib/domain/catalogue/plans';
import { listAssignmentsForPlan } from '@/lib/domain/catalogue/organization-plans';

export async function loadPlanDetail(db: Db, planKey: string) {
  const plan = await getPlan(db, planKey);
  if (!plan) return null;
  const [products, productGrants, moduleGrants, featureGrants, entitled, quotas, prices, assignments, overageRates, assumptions, addonIds, allPlans, modules, features] = await Promise.all([
    listCatalogProducts(db), listPlanProductGrants(db, plan.id), listPlanModuleGrants(db, plan.id), listPlanFeatureGrants(db, plan.id),
    planEntitledFeatureIds(db, plan.id), listPlanQuotas(db, plan.id), listPlanPrices(db, plan.id), listAssignmentsForPlan(db, plan.id),
    listPlanOverageRates(db, plan.id), listPlanUtilizationAssumptions(db, plan.id), listPlanAddonIds(db, plan.id), listPlans(db),
    listCatalogModules(db), listCatalogFeatures(db),
  ]);
  const currentPrice = prices.find((price) => price.approvalState === 'approved');
  const [marginPolicy, billingProvider, tenants] = await Promise.all([
    currentPrice ? currentPlanMarginPolicy(db, plan.id, currentPrice.currency) : Promise.resolve(null),
    platformBillingProvider(),
    listTenantsByIds(db, assignments.map((assignment) => assignment.organizationId)),
  ]);
  const provisioned = billingProvider
    ? await listProvisionedPlanPrices(db, { planPriceIds: prices.map((price) => price.id), environment: billingProvider.environment })
    : [];
  const modulesByProduct = new Map<string, typeof modules>();
  for (const catalogModule of modules) modulesByProduct.set(catalogModule.productId, [...(modulesByProduct.get(catalogModule.productId) ?? []), catalogModule]);
  const featuresByModule = new Map<string, typeof features>();
  for (const feature of features) featuresByModule.set(feature.moduleId, [...(featuresByModule.get(feature.moduleId) ?? []), feature]);
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  return {
    plan, products, productGrants, moduleGrants, featureGrants, entitled, quotas, prices, assignments, overageRates, assumptions, addonIds, allPlans,
    productGrantSet: new Set(productGrants), moduleGrantSet: new Set(moduleGrants),
    featureOverrideByFeature: new Map(featureGrants.map((grant) => [grant.featureId, grant.included])), modulesByProduct, featuresByModule,
    currentPrice, marginPolicy, addonOptions: allPlans.filter((item) => item.kind === 'addon' && item.saleStatus !== 'archived'), billingProvider,
    provisionedByPriceId: new Map(provisioned.map((row) => [row.planPriceId, row])),
    assignedOrganizations: assignments.map((assignment) => ({ assignment, tenant: tenantById.get(assignment.organizationId) ?? null })),
  };
}

export type PlanDetailModel = NonNullable<Awaited<ReturnType<typeof loadPlanDetail>>>;
