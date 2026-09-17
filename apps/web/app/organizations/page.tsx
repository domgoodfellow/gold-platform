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
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { organizationHomeHref } from '@/lib/navigation';
import { resolveOrganizationsLanding } from '@/lib/route/landing';
import { CreateBusinessForm } from './create-business-form';

export const dynamic = 'force-dynamic';

async function signOutAction() {
  'use server';
  const db = await getDb();
  await signOut(db);
  redirect('/login');
}

export default async function OrganizationsPage({ searchParams }: PageProps<'/organizations'>) {
  const db = await getDb();

  // The proxy already turned anonymous callers away, and this still runs. That is the
  // point: a redirect is not the authorization boundary (constraints.md, Security). If the
  // matcher were misconfigured tomorrow, this guard and RLS would both still hold.
  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/login');
    }
    throw error;
  }

  // Platform authority and organization membership are two independent facts about one
  // identity (D45) — a staff member's memberships are never taken away, held elsewhere, or
  // hidden by this read. What this page decides is only which of an identity's true contexts it
  // lands in *by default*: a real GOLD Internal membership becomes the operating workspace;
  // staff without it still default to the bootstrap-required Platform route. `resolveOrganizationsLanding` remains pure so
  // `landing.test.ts` can exercise every combination with no session and no database.
  const [staff, organizations] = await Promise.all([isPlatformStaff(db), listMyOrganizations(db)]);
  const preferredOrganization = await findGoldInternalOrganization(db, organizations);

  /*
    **One business is not a choice, and a whole page to make it is a page in the way.** Most
    tenant-only operators belong to exactly one, and this screen asked every one of them to read
    a list of length one and click it before anything could happen. GOLD staff who are actual
    GOLD Internal members enter that operating workspace; staff without it enter Platform.

    `?all=1` is what the shell's own *All businesses* link sends — the explicit request to see
    every business option. Without it, that link and this
    redirect would bounce a caller straight back where they came from, which is worse than the
    page it replaces — so the chooser stays reachable deliberately rather than becoming
    unreachable by accident.
  */
  const { all } = await searchParams;
  const landing = resolveOrganizationsLanding({
    organizations,
    staff,
    preferredOrganizationId: preferredOrganization?.id,
    showAll: Boolean(all),
  });

  // It cannot loop with the redirect on `/platform`, which sends a non-staff caller here: that
  // redirect fires on `!staff`, this one only on zero organizations, and one answer cannot
  // satisfy both.
  if (landing.kind === 'platform') {
    redirect('/platform');
  }
  if (landing.kind === 'enter') {
    redirect(organizationHomeHref(landing.organizationId));
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <div className="flex items-baseline justify-between">
        {/* **The heading says what the page is, which depends on whether you have any.**
            "Organizations" above a page telling somebody they have none was a title describing
            a list that was not there. */}
        <PageHeading>
          {organizations.length === 0 ? 'Set up your business' : 'Your businesses'}
        </PageHeading>
        <form action={signOutAction}>
          <Button type="submit" tone="text" size="small">
            Log out
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

          {/* Staff who explicitly asked for the chooser (`?all=1`) and belong to no business yet
              would otherwise land on this form with no way back to their one true default —
              browser back is not a route. */}
          {staff ? (
            <Hint weight="subtle" className="mt-4">
              Not looking to found a business right now?{' '}
              <Link href="/platform" className="font-medium underline underline-offset-4">
                Open Platform
              </Link>
              .
            </Hint>
          ) : null}
        </div>
      ) : (
        <DividedList className="mt-6">
          {organizations.map((organization) => (
            <li key={organization.id} className="flex items-baseline justify-between gap-4 py-3">
              <Link
                href={organizationHomeHref(organization.id)}
                className="font-medium underline underline-offset-4"
              >
                {organization.name}
              </Link>
              {/* The tenant's own word for this member's role, not a platform label. */}
              <span className="shrink-0 text-sm text-muted">{organization.role}</span>
            </li>
          ))}
          {/* Reached only via the explicit chooser (`?all=1`) now that staff default straight to
              `/platform` — so a staff member who asked to see every option gets Platform
              Administration listed alongside every business, never in place of any of them
              (D45). The switcher inside an organization offers this same link. */}
          {staff ? (
            <li className="flex items-baseline justify-between gap-4 py-3">
              <Link href="/platform" className="font-medium underline underline-offset-4">
                Platform
              </Link>
              <span className="shrink-0 text-sm text-muted">Global tools</span>
            </li>
          ) : null}
        </DividedList>
      )}
    </main>
  );
}
