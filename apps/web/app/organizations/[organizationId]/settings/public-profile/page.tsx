import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { ProfileForm } from '@/features/public-profile/profile-form';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';
import { updateProfileAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PublicProfileSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/public-profile'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const profile = await publicProfile(db, { organizationId, fallbackName: organization.name });
  const mayManage = organization.capabilities.includes('organization.manage');

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Public profile"
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Organization', href: settingsScopeHref('organization', organizationId) },
        ]}
      />
      <Hint className="mt-1 max-w-prose">
        What customers read before they book. A field left empty is simply not shown.
      </Hint>
      {mayManage ? (
        <div className="max-w-xl">
          <ProfileForm organizationId={organizationId} profile={profile} action={updateProfileAction} />
        </div>
      ) : (
        <Hint className="mt-4">
          Your role, {organization.role}, cannot change what this business says about itself.
        </Hint>
      )}
    </SettingsPageFrame>
  );
}
