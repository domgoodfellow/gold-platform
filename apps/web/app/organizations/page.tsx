import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { AREAS, areaHref } from '@/lib/navigation';
import { CreateBusinessForm } from './create-business-form';

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
        {/* **The heading says what the page is, which depends on whether you have any.**
            "Organizations" above a page telling somebody they have none was a title describing
            a list that was not there. */}
        <h1 className="text-2xl font-semibold">
          {organizations.length === 0 ? 'Set up your business' : 'Your businesses'}
        </h1>
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
        // **Founding is open again, and both doors are now open at once** (D29, amended). This
        // page used to end here, with a sentence saying businesses are set up *for* you and
        // nothing to press — which meant somebody who signed up had no way forward at all. The
        // argument for closing it was about the *quality* of a self-served business, and what it
        // actually produced was a door with nothing behind it.
        <div className="mt-4 max-w-prose">
          <p className="text-sm opacity-70">
            You do not belong to a business yet. Make one below — it takes three answers, and
            everything else about how it works is yours to set up afterwards.
          </p>
          <p className="mt-2 text-sm opacity-70">
            If you have spoken to us about being set up, we may already have made one for you. It
            will appear here as soon as it exists, and you do not need to make a second.
          </p>

          <CreateBusinessForm />
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
