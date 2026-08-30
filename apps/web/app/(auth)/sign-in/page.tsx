import Link from 'next/link';
import { CredentialsForm } from '@/components/credentials-form';
import { signInAction } from './actions';

export const metadata = { title: 'Sign in · GOLD' };

export default function SignInPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <CredentialsForm
        action={signInAction}
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        passwordAutoComplete="current-password"
      />
      <p className="mt-6 text-sm opacity-70">
        No account yet?{' '}
        <Link href="/sign-up" className="underline underline-offset-4">
          Create one
        </Link>
      </p>
    </>
  );
}
