import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { ChangePasswordForm } from '@/features/account/change-password-form';
import { AccountSectionNav } from '@/features/account/account-section-nav';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';
import { personalSettingsAncestry } from '@/lib/route/personal-settings';

export const dynamic = 'force-dynamic';

/** Personal settings → Security & sign-in. Deliberately not inside any business's Settings: a password is the person's. */
export default async function SecurityPage({ searchParams }: PageProps<'/settings/account/security'>) {
  const { org } = await searchParams;

  return (
    <PersonalSettingsShell returnOrganizationId={typeof org === 'string' ? org : undefined}>
      {({ hasPassword, signInMethods, organizationId }) => (
        <>
          <PageHeader title="Security & sign-in" crumbs={personalSettingsAncestry(organizationId)} />
          <AccountSectionNav organizationId={organizationId} />
          <Section>
            <SectionHeading>Sign-in methods</SectionHeading>
            <ul className="mt-3 space-y-2">
              {signInMethods.map((method) => <li key={method}>{method === 'email' ? 'Email and password' : method === 'google' ? 'Google' : method}</li>)}
            </ul>
          </Section>
          <Section>
            <SectionHeading>Password</SectionHeading>
            {hasPassword ? (
              <ChangePasswordForm />
            ) : (
              <Hint className="mt-2">Manage your password with your connected sign-in provider.</Hint>
            )}
          </Section>
        </>
      )}
    </PersonalSettingsShell>
  );
}
