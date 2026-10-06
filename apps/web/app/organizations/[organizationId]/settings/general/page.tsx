import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';
import { OrganizationSettingsForm } from '@/features/tenancy/organization-settings-form';

export const dynamic = 'force-dynamic';

/** Business identity and regional settings: name, timezone and currency. */
export default async function GeneralSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/general'>) {
  const { organizationId } = await params;
  const { organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');

  return (
    <SettingsPageFrame>
      <PageHeader
        title="General"
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Organization', href: settingsScopeHref('organization', organizationId) },
        ]}
      />
      <Hint className="mt-1">
        Basic organization information and regional settings.
      </Hint>

      {mayManage ? (
        <OrganizationSettingsForm
          organizationId={organizationId}
          name={organization.name}
          timezone={organization.timezone}
          currency={organization.currency}
        />
      ) : (
        <Hint className="mt-4">Your role, {organization.role}, cannot change these.</Hint>
      )}
    </SettingsPageFrame>
  );
}
