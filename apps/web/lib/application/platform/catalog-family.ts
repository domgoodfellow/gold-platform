import type { Db } from '@/lib/db/types';
import {
  getCatalogProduct,
  listCatalogFeatures,
  listCatalogModules,
  listFeatureDependencies,
  listRuntimeMappings,
} from '@/lib/domain/catalogue/catalogue';
import {
  listPlanProductGrantsForPlans,
  listPlans,
  planEntitledFeatureIdsForPlans,
} from '@/lib/domain/catalogue/plans';

export async function loadCatalogFamily(db: Db, familyKey: string) {
  const product = await getCatalogProduct(db, familyKey);
  if (!product) return null;
  const [modules, plans, allFeatures, dependencies, mappings] = await Promise.all([
    listCatalogModules(db, { productId: product.id }),
    listPlans(db),
    listCatalogFeatures(db),
    listFeatureDependencies(db),
    listRuntimeMappings(db),
  ]);
  const moduleIds = new Set(modules.map((module) => module.id));
  const allProductFeatures = allFeatures.filter((feature) => moduleIds.has(feature.moduleId));
  const featureIds = new Set(allProductFeatures.map((feature) => feature.id));
  const [entitlements, productGrants] = await Promise.all([
    planEntitledFeatureIdsForPlans(db, plans.map((plan) => plan.id)),
    listPlanProductGrantsForPlans(db, plans.map((plan) => plan.id)),
  ]);

  const featuresByModule = new Map<string, typeof allProductFeatures>();
  for (const feature of allProductFeatures) {
    featuresByModule.set(feature.moduleId, [...(featuresByModule.get(feature.moduleId) ?? []), feature]);
  }
  const dependenciesByFeature = new Map<string, { requires: string[]; requiredBy: string[] }>();
  for (const feature of allProductFeatures) dependenciesByFeature.set(feature.id, { requires: [], requiredBy: [] });
  for (const dependency of dependencies) {
    if (!featureIds.has(dependency.featureId)) continue;
    dependenciesByFeature.get(dependency.featureId)?.requires.push(dependency.requiresFeatureId);
    dependenciesByFeature.get(dependency.requiresFeatureId)?.requiredBy.push(dependency.featureId);
  }
  const mappingsByFeature = new Map<string, typeof mappings>();
  for (const mapping of mappings) {
    if (featureIds.has(mapping.featureId)) {
      mappingsByFeature.set(mapping.featureId, [...(mappingsByFeature.get(mapping.featureId) ?? []), mapping]);
    }
  }
  const grantingPlansByFeature = new Map<string, { key: string; label: string }[]>();
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  for (const entitlement of entitlements) {
    if (!featureIds.has(entitlement.featureId)) continue;
    const plan = planById.get(entitlement.planId);
    if (plan) grantingPlansByFeature.set(entitlement.featureId, [...(grantingPlansByFeature.get(entitlement.featureId) ?? []), { key: plan.key, label: plan.label }]);
  }
  const planIdsIncludingProduct = new Set(productGrants.filter((grant) => grant.productKey === product.key).map((grant) => grant.planId));
  const plansIncludingProduct = plans.filter((plan) => planIdsIncludingProduct.has(plan.id));
  const byState = {
    available: allProductFeatures.filter((feature) => feature.implementationState === 'available').length,
    partial: allProductFeatures.filter((feature) => feature.implementationState === 'partial').length,
    planned: allProductFeatures.filter((feature) => feature.implementationState === 'planned').length,
  };
  return {
    product,
    modules,
    featuresByModule,
    featureById: new Map(allProductFeatures.map((feature) => [feature.id, feature])),
    dependenciesByFeature,
    mappingsByFeature,
    grantingPlansByFeature,
    plansIncludingProduct,
    totalFeatures: allProductFeatures.length,
    byState,
    meteredCount: allProductFeatures.filter((feature) => feature.metered).length,
    providerCapabilities: [...new Set(allProductFeatures.flatMap((feature) => feature.providerCapabilities))].sort(),
  };
}

export type CatalogFamilyModel = NonNullable<Awaited<ReturnType<typeof loadCatalogFamily>>>;
