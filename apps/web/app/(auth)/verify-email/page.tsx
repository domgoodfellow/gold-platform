import { pendingInvitation } from '@/lib/route/pending-invitation';
import { readVerificationEmail } from '@/lib/route/verification-email';
import { AuthHeading, AuthSecondaryAction } from '../auth-parts';
import { VerificationForm } from './verification-form';

export const metadata = { title: 'Verify your email ? GildOps', robots: { index: false, follow: false } };
export default async function VerifyEmailPage() {
  const email = await readVerificationEmail();
  const invitation = await pendingInvitation();
  return <>
    <AuthHeading title="Verify your email">{email ? `Enter the code sent to ${email} to finish creating your GildOps account.${invitation ? ` This code is from GildOps' sign-in service and only confirms your address; afterwards you'll return to your invitation to ${invitation.businessName}.` : ''}` : 'Start signup or log in again to request a verification code.'}</AuthHeading>
    {email ? <VerificationForm /> : null}
    <AuthSecondaryAction href="/login">Back to login</AuthSecondaryAction>
    <AuthSecondaryAction href="/sign-up">Use a different email</AuthSecondaryAction>
  </>;
}
