import { Button } from '@/components/controls/button';
import { PageHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { resolveSessionIdentity } from '@/lib/domain/identity/session';
import { AcceptInvitationForm } from './accept-form';
import { continueToLoginAction, continueToSignUpAction } from './actions';
import type { Metadata } from 'next';
import { AccountAppearance } from '@/features/appearance/account-appearance';

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({
  params,
}: PageProps<'/organizations/accept-invite/[token]'>) {
  const { token } = await params;
  const db = await getDb();
  const identity = await resolveSessionIdentity(db);

  // A signed-out visitor and an anonymous Supabase session (the anonymous-session model — booking, the portal) see the
  // same prompt: neither is a permanent GOLD account, and `accept_invitation` will refuse both
  // regardless (no caller, or an email that can never match), so there is nothing this form
  // could usefully collect from either.
  if (identity.kind !== 'account') {
    return (
      <>
        <PageHeading>You&rsquo;ve been invited</PageHeading>
        <Hint className="mt-4">
          Sign in, or create an account with the email address this invitation was sent to — you&rsquo;ll
          land back here to accept it.
        </Hint>
        <div className="mt-6 flex gap-4">
          <form action={continueToLoginAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" tone="text">
              Log in
            </Button>
          </form>
          <form action={continueToSignUpAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" tone="text">
              Create an account
            </Button>
          </form>
        </div>
      </>
    );
  }

  return (
    <AccountAppearance>
      <PageHeading>You&rsquo;ve been invited</PageHeading>
      <Hint className="mt-2">
        Accepting will add you to the business that invited you, with the role they chose.
      </Hint>
      {/* An invitation works only for the address it was sent to, so say which account this is. */}
      <Hint className="mt-2">
        You&rsquo;re signed in as {(await db.auth.getUser()).data.user?.email ?? 'this account'}. If the
        invitation was sent to a different address, sign in with that address instead.
      </Hint>
      <AcceptInvitationForm token={token} />
    </AccountAppearance>
  );
}
