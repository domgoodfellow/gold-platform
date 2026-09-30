import { DividedList, Section, SectionHeading } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { areaLabel } from '@/lib/navigation';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { SettingsScopeNav } from '@/features/settings/settings-scope-nav';
import {
  listCatalogFeatures,
  listCatalogModules,
  listCatalogProducts,
} from '@/lib/domain/catalogue/catalogue';
import { organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';
import { FeatureRow } from '@/features/catalogue/feature-row';

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

  const [features, modules, products, resolved] = await Promise.all([
    listCatalogFeatures(db),
    listCatalogModules(db),
    listCatalogProducts(db),
    organizationResolvedFeatureStates(db, { organizationId }),
  ]);

  const mayManage = organization.capabilities.includes('feature.manage');
  const resolvedByFeatureId = new Map(resolved.map((r) => [r.featureId, r]));

  // Grouped by canonical Product then Module, in catalogue display order — never by the legacy
  // module list, which has no Product axis at all.
  const featuresByModuleId = new Map<string, typeof features>();
  for (const feature of features) {
    const list = featuresByModuleId.get(feature.moduleId) ?? [];
    list.push(feature);
    featuresByModuleId.set(feature.moduleId, list);
  }

  return (
    <SettingsPageFrame>
      <PageHeader title="Features" crumbs={[{ label: areaLabel('settings'), href: `/organizations/${organizationId}/settings` }]} />
      <SettingsScopeNav organizationId={organizationId} organizationName={organization.name} active="organization" />
      <Hint className="mt-1">
        What this business is entitled to, and what it has switched off. An entitled feature is
        on by default — disabling one hides it from this business without removing anything it
        has already recorded, and re-enabling restores access.
      </Hint>

      {products.map((product) => {
        const productModules = modules
          .filter((m) => m.productId === product.id)
          .filter((m) => (featuresByModuleId.get(m.id) ?? []).length > 0);
        if (productModules.length === 0) return null;

        return (
          <Section key={product.id} className="mt-8">
            <SectionHeading>{product.label}</SectionHeading>
            {productModules.map((module) => {
              const moduleFeatures = featuresByModuleId.get(module.id) ?? [];
              return (
                <div key={module.id} className="mt-4">
                  <p className="text-sm font-medium text-subtle">{module.label}</p>
                  <DividedList as="div" className="mt-1">
                    {moduleFeatures.map((feature) => {
                      const state = resolvedByFeatureId.get(feature.id);
                      if (!state) return null;
                      return (
                        <FeatureRow
                          key={feature.id}
                          organizationId={organizationId}
                          label={feature.label}
                          description={feature.description}
                          state={state}
                          mayManage={mayManage}
                        />
                      );
                    })}
                  </DividedList>
                </div>
              );
            })}
          </Section>
        );
      })}

      {mayManage ? null : (
        <Hint className="mt-4">
          Your role, {organization.role}, cannot switch features on or off for this business.
        </Hint>
      )}
    </SettingsPageFrame>
  );
}
