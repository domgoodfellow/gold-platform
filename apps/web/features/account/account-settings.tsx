import { Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { CredentialsForm } from '@/app/(auth)/credentials-form';
import type { changePasswordAction as ChangePasswordAction } from '@/app/account/actions';

/**
 * Deliberately narrow: only facts GOLD can truthfully own. There is no display name, avatar or
 * preferences section here because none is persisted anywhere authoritative — inventing one on
 * this screen would be the platform answering a question nobody was asked (constraints.md).
 */
export function AccountSettings({
  email,
  hasPassword,
  changePasswordAction,
}: {
  email: string;
  hasPassword: boolean;
  changePasswordAction: typeof ChangePasswordAction;
}) {
  return (
    <>
      <Section>
        <SectionHeading>Profile &amp; identity</SectionHeading>
        <Hint className="mt-2">{email}</Hint>
      </Section>

      <Section className="mt-10">
        <SectionHeading>Security &amp; sign-in</SectionHeading>
        {hasPassword ? (
          <CredentialsForm
            action={changePasswordAction}
            fields="password"
            confirmPassword
            submitLabel="Change password"
            pendingLabel="Changing…"
            passwordAutoComplete="new-password"
            successMessage="Password changed."
          />
        ) : (
          <Hint className="mt-2">Signed in with Google. There is no password here to change.</Hint>
        )}
      </Section>
    </>
  );
}
