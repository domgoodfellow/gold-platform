import { DividedList, PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listModuleSettings, outstandingModuleSetup } from '@/lib/domain/tenancy/modules';
import { moduleConfiguration } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { ModuleSwitch } from '../settings-forms';

export const dynamic = 'force-dynamic';

/**
 * What this business has switched on. Moved off the former `settings` god-page, unchanged in
 * substance — still the legacy `MODULES`/`organization_modules` axis (D25), still a binary
 * switch per row. The canonical Product → Module → Feature → Plan/Add-on/Entitlement model
 * (`domain-model.md`) is not rebuilt onto this screen in this slice; that is real, separate
 * work (a six-state AVAILABLE/ENTITLED/ENABLED/CONFIGURED/READY/UNAVAILABLE presentation,
 * composing `organizationResolvedFeatureStates` with this same `outstandingModuleSetup` read) and
 * is deliberately deferred rather than half-built here.
 */
export default async function FeaturesSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/features'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const modules = await listModuleSettings(db, { organizationId });
  const enabled = new Set(
    modules.filter((entry) => entry.enabledAt !== null).map((entry) => entry.module.key),
  );
  const outstanding = await outstandingModuleSetup(db, { organizationId, enabled });
  const mayManage = organization.capabilities.includes('organization.manage');

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>Features</PageHeading>
      <Hint className="mt-1">
        Turning something off hides it from this business. Nothing it has already recorded is
        removed. What every business gets — work, the schedule, customers, people and these
        settings — is not listed here, because it was never sold separately.
      </Hint>

      <DividedList as="div" className="mt-4">
        {modules.map(({ module, enabledAt }) => {
          const where = moduleConfiguration(organizationId, module);
          return (
            <ModuleSwitch
              key={module.key}
              organizationId={organizationId}
              moduleKey={module.key}
              label={module.label}
              description={module.description}
              enabled={enabledAt !== null}
              mayConfigure={mayManage}
              configureHref={where.href}
              configureLabel={where.label}
              outstanding={outstanding.get(module.key) ?? null}
            />
          );
        })}
      </DividedList>

      {mayManage ? null : (
        <Hint className="mt-4">
          Your role, {organization.role}, cannot change what this business uses.
        </Hint>
      )}
    </SettingsPageFrame>
  );
}
