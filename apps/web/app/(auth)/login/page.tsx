import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import Link from 'next/link';
import { CredentialsForm } from '../credentials-form';
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

      {/* Above *create one* on purpose: somebody who cannot get in already has an account, and
          offering them a new one first is the wrong answer to the question they arrived with. */}
      <Hint className="mt-6">
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgot password?
        </Link>
      </Hint>
      <Hint className="mt-2">
        No account yet?{' '}
        <Link href="/sign-up" className="underline underline-offset-4">
          Create one
        </Link>
      </Hint>
    </>
  );
}
