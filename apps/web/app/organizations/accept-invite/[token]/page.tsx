import Link from 'next/link';
import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { AcceptInvitationForm } from './accept-form';

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({
  params,
}: PageProps<'/organizations/accept-invite/[token]'>) {
  const { token } = await params;
  const db = await getDb();
  const { data } = await db.auth.getUser();

  if (!data.user) {
    return (
      <>
        <PageHeading>You&rsquo;ve been invited</PageHeading>
        <Hint className="mt-4">
          Sign in, or create an account with the email address this invitation was sent to, then
          come back to this link to accept it.
        </Hint>
        <div className="mt-6 flex gap-4">
          <Link href="/login" className="underline underline-offset-4">
            Log in
          </Link>
          <Link href="/sign-up" className="underline underline-offset-4">
            Create an account
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeading>You&rsquo;ve been invited</PageHeading>
      <Hint className="mt-2">
        Accepting will add you to the business that invited you, with the role they chose.
      </Hint>
      <AcceptInvitationForm token={token} />
    </>
  );
}
