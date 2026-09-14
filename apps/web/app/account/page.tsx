import { redirect } from 'next/navigation';
import { PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { CredentialsForm } from '@/app/(auth)/credentials-form';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { changePasswordAction } from './actions';

export const dynamic = 'force-dynamic';

async function signOutAction() {
  'use server';
  const db = await getDb();
  await signOut(db);
  redirect('/login');
}

/**
 * Personal Settings: identity and security for the signed-in person, independent of which
 * business or Platform context they are currently operating in (D45) — this page belongs to
 * neither. Cross-context navigation (switching business, entering Platform Administration)
 * belongs to `ContextSwitcher` alone, rendered in both shells' sidebar headers; this page no
 * longer duplicates that list.
 *
 * Deliberately narrow: only facts GOLD can truthfully own. There is no display name, avatar or
 * preferences section here because none is persisted anywhere authoritative — inventing one on
 * this screen would be the platform answering a question nobody was asked (constraints.md).
 */
export default async function AccountPage() {
  const db = await getDb();

  let email: string;
  let hasPassword: boolean;
  try {
    await requireActor(db);
    const { data } = await db.auth.getUser();
    email = data.user?.email ?? '';
    // Supabase records how somebody actually signed in as a list of identities. A Google-only
    // account has no password to change, and offering the form anyway would be a control with
    // nothing behind it (D31's reasoning, restated for auth rather than a module switch).
    hasPassword = (data.user?.identities ?? []).some((identity) => identity.provider === 'email');
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/login');
    }
    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <div className="flex items-baseline justify-between">
        <PageHeading>Account</PageHeading>
        <form action={signOutAction}>
          <Button type="submit" tone="text" size="small">
            Log out
          </Button>
        </form>
      </div>

      <Section className="mt-6">
        <SectionHeading>Profile &amp; identity</SectionHeading>
        <Hint className="mt-2">{email}</Hint>
      </Section>

      <Section className="mt-10">
        <SectionHeading>Security &amp; sign-in</SectionHeading>
        {hasPassword ? (
          <CredentialsForm
            action={changePasswordAction}
            fields="password"
            confirmPassword
            submitLabel="Change password"
            pendingLabel="Changing…"
            passwordAutoComplete="new-password"
            successMessage="Password changed."
          />
        ) : (
          <Hint className="mt-2">Signed in with Google. There is no password here to change.</Hint>
        )}
      </Section>
    </main>
  );
}
