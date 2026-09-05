import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import Link from 'next/link';
import { CredentialsForm } from '../credentials-form';
import { signUpAction } from './actions';

export const metadata = { title: 'Create an account · GOLD' };

export default function SignUpPage() {
  return (
    <>
      <PageHeading>Create an account</PageHeading>
      <CredentialsForm
        action={signUpAction}
        submitLabel="Create account"
        pendingLabel="Creating…"
        passwordAutoComplete="new-password"
        confirmPassword
      />
      <Hint className="mt-6">
        Already have one?{' '}
        <Link href="/sign-in" className="underline underline-offset-4">
          Sign in
        </Link>
      </Hint>
    </>
  );
}
