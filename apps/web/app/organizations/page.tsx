import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { AREAS, areaHref } from '@/lib/navigation';

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

  // **Staff belong to no organization, so this page is empty for them and correct for them.**
  // That is the axis working — `listMyOrganizations` filters on the caller's own membership
  // rows and they have none — and it is a terrible place to land. Sending them on is
  // convenience of exactly the kind `proxy.ts` already is: delete this and a staff member sees
  // an accurate empty list rather than anything they should not.
  //
  // It cannot loop with the redirect on `/platform`, which sends a non-staff caller here:
  // both ask `isPlatformStaff`, and one answer cannot satisfy both conditions.
  if (await isPlatformStaff(db)) {
    redirect('/platform');
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

      {/*
        This page names no area of a business, and used to name eight. Every one of them is
        now an entry in `lib/navigation.ts`, which is the whole point of that file: the
        platform's own nouns live in one place, so the terminology override `constraints.md`
        defers has one place to reach when it has evidence. A link straight to the first
        area is enough — the shell takes it from there.
      */}
      {organizations.length === 0 ? (
        // **Founding closed here** (D29). This page used to end in a form that let anybody who
        // had signed up create a business, which is the unattended door: nobody on the far
        // side of it doing the configuring, and a new business here is genuinely empty by
        // design. The sentence says what to do instead rather than only what is missing, and
        // it is deliberately not a sign-up prompt — the account already exists, which is why
        // this page rendered at all.
        <div className="mt-4 max-w-prose">
          <p className="text-sm opacity-70">You do not belong to a business yet.</p>
          <p className="mt-2 text-sm opacity-70">
            Businesses on GOLD are set up with you rather than by you — get in touch and we
            will configure yours against how you actually work. Once it exists, this is where
            you will find it.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {organizations.map((organization) => (
            <li key={organization.id} className="flex items-baseline justify-between gap-4 py-3">
              <Link
                href={areaHref(organization.id, AREAS[0].segment)}
                className="font-medium underline underline-offset-4"
              >
                {organization.name}
              </Link>
              {/* The tenant's own word for this member's role, not a platform label. */}
              <span className="shrink-0 text-sm opacity-70">{organization.role}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
