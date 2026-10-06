import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
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
      {({ email, displayName, pendingEmail, organizationId }) => (
        <>
          <PageHeader title="Profile" crumbs={personalSettingsAncestry(organizationId)} />
          <AccountSectionNav organizationId={organizationId} />
          {emailChange === 'failed' ? <Hint role="alert">That confirmation link is invalid or expired. Request a new change.</Hint> : null}
          <Section>
            <SectionHeading>Display name</SectionHeading>
            <PersonalProfileForm displayName={displayName} />
          </Section>
          <Section>
            <SectionHeading>Email address</SectionHeading>
            <ChangeEmailForm email={email} pendingEmail={pendingEmail} />
            <Hint className="mt-4 block">
              Your identity. It belongs to you, not to any business, and applies in every business you belong to.
            </Hint>
          </Section>
        </>
      )}
    </PersonalSettingsShell>
  );
}
