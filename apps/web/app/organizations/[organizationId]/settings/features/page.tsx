import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import {
  listCatalogFeatures,
  listCatalogModules,
  listCatalogProducts,
} from '@/lib/domain/catalogue/catalogue';
import { organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';
import { FeatureCatalogue, type CatalogueFeature } from '@/features/catalogue/feature-catalogue';
import { configTargetOffered, featureConfigurationTarget } from '@/lib/navigation';
import { activeModuleKeys, availableFeatureKeys } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';

export const dynamic = 'force-dynamic';

/**
 * What this business is entitled to, and what it has deliberately switched off — the canonical
 * Product → Module → Feature model (`domain-model.md`), replacing the flat legacy `MODULES` list
 * this screen showed before. Entitled ordinary capabilities are active by default (opt-out, not
 * opt-in): a row with nothing said about it here is on.
 *
 * `feature.manage`, not `organization.manage`, gates disabling/enabling — a distinct capability
 * now that one exists, the same split `role.manage` already draws from `organization.manage`.
 */
export default async function FeaturesSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/features'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [features, modules, products, schedulableWork] = await Promise.all([
    listCatalogFeatures(db),
    listCatalogModules(db),
    listCatalogProducts(db),
    hasSchedulableWork(db, { organizationId }),
  ]);
  const resolved = await organizationResolvedFeatureStates(db, { organizationId }, { features, modules, products });

  const mayManage = organization.capabilities.includes('feature.manage');
  const gate = { capabilities: new Set(organization.capabilities), enabledModules: activeModuleKeys(resolved), featureAvailability: availableFeatureKeys(resolved), schedulableWork };
  const resolvedByFeatureId = new Map(resolved.map((r) => [r.featureId, r]));

  // Catalogue display order: Product, then Module, then Feature — never the legacy module list.
  const items: CatalogueFeature[] = products.flatMap((product) => modules
    .filter((module) => module.productId === product.id)
    .flatMap((module) => features
      .filter((feature) => feature.moduleId === module.id)
      .flatMap((feature) => {
        const state = resolvedByFeatureId.get(feature.id);
        if (!state) return [];
        const target = featureConfigurationTarget(feature.key);
        return [{
          id: feature.id, label: feature.label, description: feature.description, product: product.label, module: module.label, state,
          mayConfigure: target ? configTargetOffered(target, gate) : mayManage || organization.capabilities.includes('organization.manage'),
        }];
      })));

  return (
    <SettingsPageFrame>
      <SettingsPageHeader title="Features" />
      <Hint className="mt-1">
        An included feature is on unless switched off here; switching one off keeps everything it has recorded.
      </Hint>
      <FeatureCatalogue organizationId={organizationId} features={items} mayManage={mayManage} />
    </SettingsPageFrame>
  );
}
