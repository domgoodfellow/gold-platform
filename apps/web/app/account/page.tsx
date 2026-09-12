import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DividedList, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { CredentialsForm } from '@/app/(auth)/credentials-form';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { AREAS, areaHref } from '@/lib/navigation';
import { changePasswordAction } from './actions';

export const dynamic = 'force-dynamic';

async function signOutAction() {
  'use server';
  const db = await getDb();
  await signOut(db);
  redirect('/login');
}

/**
 * The one destination for a signed-in human, independent of which business or platform context
 * they are currently in — the same identity holds both (D45), and this page belongs to neither.
 *
 * Deliberately narrow: only facts GOLD can truthfully own. There is no display name or avatar
 * field here because none is persisted anywhere authoritative — inventing one on this screen
 * would be the platform answering a question nobody was asked (constraints.md).
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

  const [organizations, staff] = await Promise.all([
    listMyOrganizations(db),
    isPlatformStaff(db),
  ]);

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

      <Hint className="mt-3">{email}</Hint>

      {hasPassword ? (
        <Section className="mt-10">
          <SectionHeading>Password</SectionHeading>
          <CredentialsForm
            action={changePasswordAction}
            fields="password"
            confirmPassword
            submitLabel="Change password"
            pendingLabel="Changing…"
            passwordAutoComplete="new-password"
            successMessage="Password changed."
          />
        </Section>
      ) : (
        <Hint className="mt-10">
          Signed in with Google. There is no password here to change.
        </Hint>
      )}

      <Section className="mt-10">
        <SectionHeading>Businesses</SectionHeading>

        {organizations.length === 0 ? (
          <Hint className="mt-2">Not a member of any business yet.</Hint>
        ) : (
          <DividedList className="mt-2">
            {organizations.map((organization) => (
              <li key={organization.id} className="flex items-baseline justify-between gap-4 py-3">
                <Link
                  href={areaHref(organization.id, AREAS[0].segment)}
                  className="font-medium underline underline-offset-4"
                >
                  {organization.name}
                </Link>
                <span className="shrink-0 text-sm text-muted">{organization.role}</span>
              </li>
            ))}
          </DividedList>
        )}

        <Link href="/organizations?all=1" className="mt-3 inline-block text-sm underline underline-offset-4">
          Switch business
        </Link>
      </Section>

      {staff ? (
        <Section className="mt-10">
          <SectionHeading>Platform</SectionHeading>
          <Link href="/platform" className="underline underline-offset-4">
            Platform Administration
          </Link>
        </Section>
      ) : null}
    </main>
  );
}
