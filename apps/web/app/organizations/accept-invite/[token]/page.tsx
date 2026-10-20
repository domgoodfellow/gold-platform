import { Button } from '@/components/controls/button';
import { PageHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { resolveSessionIdentity } from '@/lib/domain/identity/session';
import { previewInvitation, type InvitationPreview } from '@/lib/domain/tenancy/invitations';
import { AcceptInvitationForm } from './accept-form';
import { continueToLoginAction, continueToSignUpAction, switchAccountAction } from './actions';
import type { Metadata } from 'next';
import { AccountAppearance } from '@/features/appearance/account-appearance';

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export const dynamic = 'force-dynamic';

/** The expiry as a sentence ending, without doubling a full stop some locales already put on the time. */
function expiry(value: string): string {
  const moment = new Date(value).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  return moment.endsWith('.') ? moment : `${moment}.`;
}

/** What the link is for, said once, before anything is asked of the person holding it. */
function InvitationSummary({ preview }: { preview: Extract<InvitationPreview, { state: 'valid' }> }) {
  return (
    <Hint className="mt-2">
      {preview.businessName} invited <span className="font-medium text-foreground">{preview.email}</span> to join as{' '}
      {preview.roleName}. This invitation expires {expiry(preview.expiresAt)}
    </Hint>
  );
}

export default async function AcceptInvitePage({
  params,
}: PageProps<'/organizations/accept-invite/[token]'>) {
  const { token } = await params;
  const db = await getDb();
  const [identity, preview] = await Promise.all([resolveSessionIdentity(db), previewInvitation(db, token)]);

  // Unknown, revoked, replaced, expired and used links all read the same, as accepting them would.
  if (preview.state === 'invalid') {
    return (
      <>
        <PageHeading>This invitation can&rsquo;t be used</PageHeading>
        <Hint className="mt-4">
          It may have expired, been replaced by a newer invitation, been cancelled, or already been accepted. Ask the person
          who invited you to send a new invitation.
        </Hint>
      </>
    );
  }

  // A signed-out visitor and an anonymous Supabase session (the anonymous-session model — booking, the portal) see the
  // same prompt: neither is a permanent GOLD account, and `accept_invitation` will refuse both
  // regardless (no caller, or an email that can never match), so there is nothing this form
  // could usefully collect from either.
  if (identity.kind !== 'account') {
    return (
      <>
        <PageHeading>You&rsquo;ve been invited to {preview.businessName}</PageHeading>
        <InvitationSummary preview={preview} />
        <Hint className="mt-4">
          Already use GildOps with {preview.email}? Log in. New to GildOps? Create an account with that address — you&rsquo;ll be
          sent a verification code to confirm it, then brought back here to accept.
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

  const signedInAs = ((await db.auth.getUser()).data.user?.email ?? '').toLowerCase();

  // The wrong account: say so, and offer to switch. Nothing signs anybody in as anyone else.
  if (signedInAs !== preview.email.toLowerCase()) {
    return (
      <AccountAppearance>
        <PageHeading>You&rsquo;ve been invited to {preview.businessName}</PageHeading>
        <InvitationSummary preview={preview} />
        <Hint className="mt-4">
          You&rsquo;re signed in as {signedInAs || 'another account'}. This invitation works only for {preview.email}.
        </Hint>
        <form action={switchAccountAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <Button type="submit">Sign out and continue as {preview.email}</Button>
        </form>
      </AccountAppearance>
    );
  }

  return (
    <AccountAppearance>
      <PageHeading>You&rsquo;ve been invited to {preview.businessName}</PageHeading>
      <InvitationSummary preview={preview} />
      <Hint className="mt-2">You&rsquo;re signed in as {signedInAs}.</Hint>
      <AcceptInvitationForm token={token} />
    </AccountAppearance>
  );
}
