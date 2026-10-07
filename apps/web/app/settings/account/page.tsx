import { PageHeader } from '@/components/headers/page-header';
import { PersonalProfileForm, ChangeEmailForm } from '@/features/account/profile-form';
import { Hint } from '@/components/controls/inputs';
import { AccountSectionNav } from '@/features/account/account-section-nav';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';
import { personalSettingsAncestry } from '@/lib/route/personal-settings';

export const dynamic = 'force-dynamic';

/** Personal settings → Profile. The person's identity, which no business owns (D45). */
export default async function ProfilePage({ searchParams }: PageProps<'/settings/account'>) {
  const { org, emailChange } = await searchParams;

  return (
    <PersonalSettingsShell returnOrganizationId={typeof org === 'string' ? org : undefined}>
      {({ email, profile, pendingEmail, organizationId }) => (
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <PageHeader title="Profile" crumbs={personalSettingsAncestry(organizationId)} />
          <AccountSectionNav organizationId={organizationId} />
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
