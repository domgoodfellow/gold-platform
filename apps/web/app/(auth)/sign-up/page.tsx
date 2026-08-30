import Link from 'next/link';
import { CredentialsForm } from '@/components/credentials-form';
import { signUpAction } from './actions';

export const metadata = { title: 'Create an account · GOLD' };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <CredentialsForm
        action={signUpAction}
        submitLabel="Create account"
        pendingLabel="Creating…"
        passwordAutoComplete="new-password"
        confirmPassword
      />
      <p className="mt-6 text-sm opacity-70">
        Already have one?{' '}
        <Link href="/sign-in" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </>
  );
}
