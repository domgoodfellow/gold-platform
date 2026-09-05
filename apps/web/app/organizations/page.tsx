import { Hint } from '@/components/controls/inputs';
import { DividedList, PageHeading } from '@/components/containers/section';
import { Button } from '@/components/controls/button';
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
        <PageHeading>
          {organizations.length === 0 ? 'Set up your business' : 'Your businesses'}
        </PageHeading>
        <form action={signOutAction}>
          <Button type="submit" tone="text" size="small">
            Sign out
          </Button>
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
        <div className="mt-3 max-w-prose">
          <p className="text-base opacity-80">
            Two questions and yours exists. Everything else — what you call your work, how a job
            moves, what you charge — comes next, and none of it is set in stone.
          </p>

          <CreateBusinessForm />

          {/* Quieter than the form and below it, because it applies to a minority of readers and
              the ones it does not apply to should not have to read past it to reach the fields. */}
          <Hint weight="subtle" className="mt-10 border-t border-border pt-4">
            Spoken to us about being set up already? Yours will appear here as soon as it exists
            — there is no need to make a second one.
          </Hint>
        </div>
      ) : (
        <DividedList className="mt-6">
          {organizations.map((organization) => (
            <li key={organization.id} className="flex items-baseline justify-between gap-4 py-3">
              <Link
                href={areaHref(organization.id, AREAS[0].segment)}
                className="font-medium underline underline-offset-4"
              >
                {organization.name}
              </Link>
              {/* The tenant's own word for this member's role, not a platform label. */}
              <span className="shrink-0 text-sm text-muted">{organization.role}</span>
            </li>
          ))}
        </DividedList>
      )}
    </main>
  );
}
