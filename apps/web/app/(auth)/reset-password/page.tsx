import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CredentialsForm } from '../credentials-form';
import { getDb } from '@/lib/db/server';
import { resetPasswordAction } from './actions';

export const metadata = { title: 'Set a new password · GildOps' };

export const dynamic = 'force-dynamic';

/**
 * Setting a new password, for somebody who followed a recovery link.
 *
 * **`/auth/recover` is what proves who they are, and this checks the result of that rather than
 * trusting the visit.** Reaching this URL with no session means the link was never followed, has
 * expired, or belongs to somebody else's browser — so there is nobody to change a password for,
 * and the honest answer is the screen that issues a new link. The guard is not the boundary
 * either way: with no session the auth server refuses the update, which is where it is actually
 * decided (I12's shape, one axis over).
 */
export default async function ResetPasswordPage() {
  const db = await getDb();
  const { data } = await db.auth.getUser();

  if (!data.user) {
    redirect('/forgot-password');
  }

  return (
    <>
      <PageHeading>Set a new password</PageHeading>
      <Hint className="mt-3">For {data.user.email}.</Hint>

      <CredentialsForm
        action={resetPasswordAction}
        fields="password"
        submitLabel="Save it and continue"
        pendingLabel="Saving…"
        passwordAutoComplete="new-password"
        confirmPassword
      />

      <Hint className="mt-6">
        <Link href="/login" className="underline underline-offset-4">
          Back to logging in
        </Link>
      </Hint>
    </>
  );
}
