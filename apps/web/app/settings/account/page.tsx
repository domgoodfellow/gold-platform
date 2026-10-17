import { SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { PersonalProfileForm, ChangeEmailForm } from '@/features/account/profile-form';
import { Hint } from '@/components/controls/inputs';
import { AccountSectionNav } from '@/features/account/account-section-nav';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';

export const dynamic = 'force-dynamic';

/** Personal settings → Profile. The person's identity, which no business owns. */
export default async function ProfilePage({ searchParams }: PageProps<'/settings/account'>) {
  const { org, emailChange } = await searchParams;

  return (
    <PersonalSettingsShell returnOrganizationId={typeof org === 'string' ? org : undefined}>
      {({ email, profile, pendingEmail, organizationId }) => (
        <div className="space-y-6">
          <SettingsPageHeader title="Profile" />
          {organizationId ? null : <AccountSectionNav organizationId={organizationId} />}
          {emailChange === 'failed' ? <Hint role="alert">That confirmation link is invalid or expired. Request a new change.</Hint> : null}
          <PersonalProfileForm profile={profile} email={email} />
          <ChangeEmailForm email={email} pendingEmail={pendingEmail} />
          <Hint className="pb-6">
            Your identity belongs to you, not to any business, and applies across every business you belong to.
          </Hint>
        </div>
      )}
    </PersonalSettingsShell>
  );
}
