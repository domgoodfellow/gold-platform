import type { Db } from '@/lib/db/types';
import { listTenantsByIds } from '@/lib/domain/platform/tenants';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import {
  getPlan, listPlanFeatureGrants, listPlanModuleGrants, listPlanProductGrants, listPlanQuotas, planEntitledFeatureIds,
} from '@/lib/domain/catalogue/plans';
import { listAssignmentsForPlan } from '@/lib/domain/catalogue/organization-plans';

/**
 * What one GildOps plan switches on — product, module and feature grants and allowances — and
 * which businesses hold it, for the plan's own item in GildOps' Catalog & Pricing (ADR-057). Every
 * read runs as the member; the switch list is readable by members, the businesses holding it only
 * with `subscription.read`.
 */
export async function loadPlanSwitches(db: Db, planKey: string) {
  const plan = await getPlan(db, planKey);
  if (!plan) return null;
  const [products, productGrants, moduleGrants, featureGrants, entitled, quotas, assignments, modules, features] = await Promise.all([
    listCatalogProducts(db), listPlanProductGrants(db, plan.id), listPlanModuleGrants(db, plan.id), listPlanFeatureGrants(db, plan.id),
    planEntitledFeatureIds(db, plan.id), listPlanQuotas(db, plan.id), listAssignmentsForPlan(db, plan.id),
    listCatalogModules(db), listCatalogFeatures(db),
  ]);
  const tenants = await listTenantsByIds(db, assignments.map((assignment) => assignment.organizationId));
  const modulesByProduct = new Map<string, typeof modules>();
  for (const catalogModule of modules) modulesByProduct.set(catalogModule.productId, [...(modulesByProduct.get(catalogModule.productId) ?? []), catalogModule]);
  const featuresByModule = new Map<string, typeof features>();
  for (const feature of features) featuresByModule.set(feature.moduleId, [...(featuresByModule.get(feature.moduleId) ?? []), feature]);
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  return {
    plan, products, productGrants, featureGrants, entitled, quotas, assignments,
    productGrantSet: new Set(productGrants), moduleGrantSet: new Set(moduleGrants),
    featureOverrideByFeature: new Map(featureGrants.map((grant) => [grant.featureId, grant.included])), modulesByProduct, featuresByModule,
    assignedOrganizations: assignments.map((assignment) => ({ assignment, tenant: tenantById.get(assignment.organizationId) ?? null })),
  };
}

export type PlanSwitchesModel = NonNullable<Awaited<ReturnType<typeof loadPlanSwitches>>>;
