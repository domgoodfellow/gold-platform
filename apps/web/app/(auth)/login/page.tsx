import { AuthDivider, AuthHeading, AuthSecondaryAction } from '../auth-parts';
import { CredentialsForm } from '../credentials-form';
import { GoogleAuthButton } from '../google-auth-button';
import { logInAction } from './actions';

export const metadata = { title: 'Log in · GildOps' };

export default function LogInPage() {
  return (
    <>
      <AuthHeading title="Log in" />

      <CredentialsForm
        action={logInAction}
        fields="email-and-password"
        submitLabel="Log in"
        pendingLabel="Logging in…"
        passwordAutoComplete="current-password"
        recoveryHref="/forgot-password"
      />

      <AuthDivider />
      <GoogleAuthButton />

      <AuthSecondaryAction prompt="Don’t have an account?" href="/sign-up">
        Create an account
      </AuthSecondaryAction>
    </>
  );
}
