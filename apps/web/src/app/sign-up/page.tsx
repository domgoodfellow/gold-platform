import Link from 'next/link';
import { CredentialsForm } from '@/components/credentials-form';
import { signUpAction } from './actions';

export const metadata = { title: 'Create an account · GOLD' };

export default function SignUpPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <CredentialsForm
        action={signUpAction}
        submitLabel="Create account"
        pendingLabel="Creating…"
        passwordAutoComplete="new-password"
      />
      <p className="mt-6 text-sm opacity-70">
        Already have one?{' '}
        <Link href="/sign-in" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
