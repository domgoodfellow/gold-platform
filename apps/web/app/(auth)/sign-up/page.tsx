import { pendingInvitation } from '@/lib/route/pending-invitation';
import { AuthDivider, AuthHeading, AuthSecondaryAction } from '../auth-parts';
import { CredentialsForm } from '../credentials-form';
import { GoogleAuthButton } from '../google-auth-button';
import { signUpAction } from './actions';

export const metadata = { title: 'Create an account · GildOps' };

export default async function SignUpPage() {
  const invitation = await pendingInvitation();
  return (
    <>
      <AuthHeading title="Create an account">
        {invitation
          ? `Use ${invitation.email}, the address ${invitation.businessName} invited. We'll email you a code to confirm it, then bring you back to accept.`
          : null}
      </AuthHeading>

      <CredentialsForm
        action={signUpAction}
        fields="email-and-password"
        submitLabel="Create account"
        pendingLabel="Creating…"
        passwordAutoComplete="new-password"
        collectProfile
        confirmPassword
        defaultEmail={invitation?.email}
      />

      <AuthDivider />
      <GoogleAuthButton />

      <AuthSecondaryAction prompt="Already have an account?" href="/login">
        Log in
      </AuthSecondaryAction>
    </>
  );
}
