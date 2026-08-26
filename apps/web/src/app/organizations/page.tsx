import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { CreateOrganizationForm } from './create-organization-form';

export const dynamic = 'force-dynamic';

async function signOutAction() {
  'use server';
  const db = await getDb();
  await signOut(db);
  redirect('/sign-in');
}

export default async function OrganizationsPage() {
  const db = await getDb();

  // The proxy already turned anonymous callers away, and this still runs. That is the
  // point: a redirect is not the authorization boundary (constraints.md, Security). If the
  // matcher were misconfigured tomorrow, this guard and RLS would both still hold.
  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/sign-in');
    }
    throw error;
  }

  const organizations = await listMyOrganizations(db);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <form action={signOutAction}>
          <button type="submit" className="text-sm underline underline-offset-4 opacity-70">
            Sign out
          </button>
        </form>
      </div>

      {organizations.length === 0 ? (
        <p className="mt-4 text-sm opacity-70">You do not belong to an organization yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {organizations.map((organization) => (
            <li key={organization.id} className="flex items-baseline justify-between py-3">
              <Link
                href={`/organizations/${organization.id}/customers`}
                className="font-medium underline underline-offset-4"
              >
                {organization.name}
              </Link>
              <span className="text-sm opacity-70">{organization.role}</span>
            </li>
          ))}
        </ul>
      )}

      <CreateOrganizationForm />
    </main>
  );
}
