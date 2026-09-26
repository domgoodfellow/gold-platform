import { AuthHeading, AuthSecondaryAction } from '../auth-parts';
import { CredentialsForm } from '../credentials-form';
import { forgotPasswordAction } from './actions';

export const metadata = { title: 'Forgotten password · GildOps' };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title="Forgotten your password?">
        Give us the address you signed up with and we will send a link that lets you set a new
        one.
      </AuthHeading>

      <CredentialsForm
        action={forgotPasswordAction}
        fields="email"
        submitLabel="Send me a link"
        pendingLabel="Sending…"
        passwordAutoComplete="current-password"
        // **The same sentence for every address, whether or not it has an account.** Anything
        // that read differently would let somebody try a list of emails and learn which of them
        // belong to customers of this platform. It says what was done, not what was found.
        successMessage="If that address has an account, a link is on its way. It expires, so use it soon."
      />

      <AuthSecondaryAction href="/login">Back to logging in</AuthSecondaryAction>
    </>
  );
}
