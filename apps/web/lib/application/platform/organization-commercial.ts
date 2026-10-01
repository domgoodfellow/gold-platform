import type { Db } from '@/lib/db/types';
import { getTenant } from '@/lib/domain/platform/tenants';
import { listOrganizationTerms, moduleCommercialState } from '@/lib/domain/commercial/terms';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import { listPlans } from '@/lib/domain/catalogue/plans';
import {
  currentAddonAssignments,
  currentPlanAssignment,
  listOrganizationPlanAgreements,
  listOrganizationPlanAssignments,
  organizationEffectiveQuotas,
  organizationPlanPrice,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';

export async function loadOrganizationCommercial(db: Db, organizationId: string) {
  const tenant = await getTenant(db, organizationId);
  if (!tenant) return null;
  const [terms, states, products, plans, basePlan, addons, resolvedFeatures, quotas, agreements, assignmentHistory, catalogProducts, catalogModules, catalogFeatures] = await Promise.all([
    listOrganizationTerms(db, { organizationId }), moduleCommercialState(db, { organizationId }), listProducts(db), listPlans(db),
    currentPlanAssignment(db, { organizationId }), currentAddonAssignments(db, { organizationId }), organizationResolvedFeatureStates(db, { organizationId }),
    organizationEffectiveQuotas(db, { organizationId }), listOrganizationPlanAgreements(db, { organizationId }), listOrganizationPlanAssignments(db, { organizationId }),
    listCatalogProducts(db), listCatalogModules(db), listCatalogFeatures(db),
  ]);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const standardPrice = basePlan ? await organizationPlanPrice(db, { organizationId, planId: basePlan.planId }) : null;
  return {
    tenant, terms, states, products, plans, basePlan, addons, resolvedFeatures, quotas, agreements, assignmentHistory,
    catalogProducts, catalogModules, catalogFeatures, standardPrice,
    basePlanDefinition: basePlan ? (planById.get(basePlan.planId) ?? null) : null,
    addonDefinitions: addons.map((assignment) => planById.get(assignment.planId) ?? null),
    moduleById: new Map(catalogModules.map((module) => [module.id, module])),
    productById: new Map(catalogProducts.map((product) => [product.id, product])),
    resolvedByFeature: new Map(resolvedFeatures.map((feature) => [feature.featureId, feature])),
  };
}

export type OrganizationCommercialModel = NonNullable<Awaited<ReturnType<typeof loadOrganizationCommercial>>>;
