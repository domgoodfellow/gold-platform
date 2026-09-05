import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import Link from 'next/link';
import { CredentialsForm } from '../credentials-form';
import { signInAction } from './actions';

export const metadata = { title: 'Sign in · GOLD' };

export default function SignInPage() {
  return (
    <>
      <PageHeading>Sign in</PageHeading>
      <CredentialsForm
        action={signInAction}
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        passwordAutoComplete="current-password"
      />
      <Hint className="mt-6">
        No account yet?{' '}
        <Link href="/sign-up" className="underline underline-offset-4">
          Create one
        </Link>
      </Hint>
    </>
  );
}
