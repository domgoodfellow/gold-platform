import { Hint } from '@/components/controls/inputs';
import { ProfileForm } from '@/features/public-profile/profile-form';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { requireOrganization } from '@/lib/route/organization';
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
      <SettingsPageHeader title="Public profile" />
      {mayManage ? (
        <div className="max-w-xl">
          <ProfileForm organizationId={organizationId} profile={profile} action={updateProfileAction} />
        </div>
      ) : (
        <Hint>
          Your role, {organization.role}, cannot change what this business says about itself.
        </Hint>
      )}
    </SettingsPageFrame>
  );
}
