import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { CredentialsForm } from '@/app/(auth)/credentials-form';
import { AccountSectionNav } from '@/features/account/account-section-nav';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';
import { personalSettingsAncestry } from '@/lib/route/personal-settings';
import { changePasswordAction } from '../actions';

export const dynamic = 'force-dynamic';

/** Personal settings → Security & sign-in. Deliberately not inside any business's Settings: a password is the person's. */
export default async function SecurityPage({ searchParams }: PageProps<'/settings/account/security'>) {
  const { org } = await searchParams;

  return (
    <PersonalSettingsShell returnOrganizationId={typeof org === 'string' ? org : undefined}>
      {({ hasPassword, organizationId }) => (
        <>
          <PageHeader title="Security & sign-in" crumbs={personalSettingsAncestry(organizationId)} />
          <AccountSectionNav organizationId={organizationId} />
          <Section>
            <SectionHeading>Password</SectionHeading>
            {hasPassword ? (
              <div className="max-w-md">
                <CredentialsForm
                  action={changePasswordAction}
                  fields="password"
                  confirmPassword
                  submitLabel="Change password"
                  pendingLabel="Changing…"
                  passwordAutoComplete="new-password"
                  successMessage="Password changed."
                />
              </div>
            ) : (
              <Hint className="mt-2">Signed in with Google. There is no password here to change.</Hint>
            )}
          </Section>
        </>
      )}
    </PersonalSettingsShell>
  );
}
