import { AuthDivider, AuthHeading, AuthSecondaryAction } from '../auth-parts';
import { CredentialsForm } from '../credentials-form';
import { GoogleAuthButton } from '../google-auth-button';
import { signUpAction } from './actions';

export const metadata = { title: 'Create an account · GildOps' };

export default function SignUpPage() {
  return (
    <>
      <AuthHeading title="Create an account" />

      <CredentialsForm
        action={signUpAction}
        fields="email-and-password"
        submitLabel="Create account"
        pendingLabel="Creating…"
        passwordAutoComplete="new-password"
        confirmPassword
      />

      <AuthDivider />
      <GoogleAuthButton />

      <AuthSecondaryAction prompt="Already have an account?" href="/login">
        Log in
      </AuthSecondaryAction>
    </>
  );
}
