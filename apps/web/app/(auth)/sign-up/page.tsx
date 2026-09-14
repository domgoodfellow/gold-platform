import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import Link from 'next/link';
import { CredentialsForm } from '../credentials-form';
import { GoogleAuthButton } from '../google-auth-button';
import { signUpAction } from './actions';

export const metadata = { title: 'Create an account · GOLD' };

export default function SignUpPage() {
  return (
    <>
      <PageHeading>Create an account</PageHeading>
      <CredentialsForm
        action={signUpAction}
        fields="email-and-password"
        submitLabel="Create account"
        pendingLabel="Creating…"
        passwordAutoComplete="new-password"
        confirmPassword
      />

      <GoogleAuthButton />

      <Hint className="mt-6">
        Already have one?{' '}
        <Link href="/login" className="underline underline-offset-4">
          Log in
        </Link>
      </Hint>
    </>
  );
}
