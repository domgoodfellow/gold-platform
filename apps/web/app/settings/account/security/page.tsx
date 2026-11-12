import { SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { CardSection } from '@/components/surfaces/card';
import { Hint } from '@/components/controls/inputs';
import { ChangePasswordForm } from '@/features/account/change-password-form';
import { AccountSectionNav } from '@/features/account/account-section-nav';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';

export const dynamic = 'force-dynamic';

/** Personal settings → Security & sign-in. Deliberately not inside any business's Settings: a password is the person's. */
export default async function SecurityPage({ searchParams }: PageProps<'/settings/account/security'>) {
  const { org } = await searchParams;

  return (
    <PersonalSettingsShell returnOrganizationId={typeof org === 'string' ? org : undefined}>
      {({ hasPassword, signInMethods, organizationId }) => (
        <div className="space-y-6">
          <SettingsPageHeader title="Security & sign-in" />
          {organizationId ? null : <AccountSectionNav organizationId={organizationId} />}
          <CardSection title="Sign-in methods">
            <ul className="mt-3 space-y-2">
              {signInMethods.map((method) => <li key={method}>{method === 'email' ? 'Email and password' : method === 'google' ? 'Google' : method}</li>)}
            </ul>
          </CardSection>
          <CardSection title="Password">
            {hasPassword ? (
              <ChangePasswordForm />
            ) : (
              <Hint className="mt-2">Manage your password with the service you sign in with, such as Google.</Hint>
            )}
          </CardSection>
        </div>
      )}
    </PersonalSettingsShell>
  );
}
