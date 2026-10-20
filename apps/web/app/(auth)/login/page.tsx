import { pendingInvitation } from '@/lib/route/pending-invitation';
import { AuthDivider, AuthHeading, AuthSecondaryAction } from '../auth-parts';
import { CredentialsForm } from '../credentials-form';
import { GoogleAuthButton } from '../google-auth-button';
import { logInAction } from './actions';

export const metadata = { title: 'Log in · GildOps' };

export default async function LogInPage() {
  const invitation = await pendingInvitation();
  return (
    <>
      <AuthHeading title="Log in">
        {invitation ? `Log in with ${invitation.email} to accept your invitation to ${invitation.businessName}.` : null}
      </AuthHeading>

      <CredentialsForm
        action={logInAction}
        fields="email-and-password"
        submitLabel="Log in"
        pendingLabel="Logging in…"
        passwordAutoComplete="current-password"
        recoveryHref="/forgot-password"
        defaultEmail={invitation?.email}
      />

      <AuthDivider />
      <GoogleAuthButton />

      <AuthSecondaryAction prompt="Don’t have an account?" href="/sign-up">
        Create an account
      </AuthSecondaryAction>
    </>
  );
}
