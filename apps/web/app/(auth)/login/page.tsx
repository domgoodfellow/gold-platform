import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import Link from 'next/link';
import { CredentialsForm } from '../credentials-form';
import { GoogleAuthButton } from '../google-auth-button';
import { logInAction } from './actions';

export const metadata = { title: 'Log in · GOLD' };

export default function LogInPage() {
  return (
    <>
      <PageHeading>Log in</PageHeading>

      <CredentialsForm
        action={logInAction}
        fields="email-and-password"
        submitLabel="Log in"
        pendingLabel="Logging in…"
        passwordAutoComplete="current-password"
      />

      <GoogleAuthButton />

      <Hint className="mt-6">
        <Link
          href="/forgot-password"
          className="underline underline-offset-4"
        >
          Forgot password?
        </Link>
      </Hint>

      <Hint className="mt-2">
        No account yet?{' '}
        <Link
          href="/sign-up"
          className="underline underline-offset-4"
        >
          Create one
        </Link>
      </Hint>
    </>
  );
}
