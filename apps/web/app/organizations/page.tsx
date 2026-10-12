import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/surfaces/section';
import { Button } from '@/components/controls/button';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { organizationHomeHref } from '@/lib/navigation';
import { readLastOrganizationId, resolveOrganizationsLanding } from '@/lib/route/landing';
import { CreateBusinessForm } from './create-business-form';
import { AccountAppearance } from '@/features/appearance/account-appearance';

export const dynamic = 'force-dynamic';

async function signOutAction() {
  'use server';
  const db = await getDb();
  await signOut(db);
  redirect('/login');
}

/**
 * Where a sign-in lands, and where somebody with no business yet founds their first. It is not a
 * directory of businesses and not how anyone switches context — the context switcher links
 * straight to a business. Anyone with a business is sent into it, so what this
 * page renders is only the founding form.
 */
export default async function OrganizationsPage() {
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
  // lands in *by default*: a real GOLD Internal membership becomes the operating workspace; staff
  // without it still default to the bootstrap-required Platform route; everyone else enters the
  // business they last worked in, else their first. `resolveOrganizationsLanding` remains pure so
  // `landing.test.ts` can exercise every combination with no session and no database.
  const [staff, organizations] = await Promise.all([isPlatformStaff(db), listMyOrganizations(db)]);
  const preferredOrganization = await findGoldInternalOrganization(db, organizations);
  const landing = resolveOrganizationsLanding({
    organizations,
    staff,
    preferredOrganizationId: preferredOrganization?.id,
    lastOrganizationId: await readLastOrganizationId(),
  });

  // Staff who hold no GOLD Internal membership have no canonical Platform address to be sent to, so
  // they meet the legacy entry, which says why. It cannot loop with that entry, which sends a
  // non-staff caller here: that fires on `!staff`, this only on `staff`, and one answer cannot
  // satisfy both.
  if (landing.kind === 'platform') {
    redirect('/platform');
  }
  if (landing.kind === 'enter') {
    redirect(organizationHomeHref(landing.organizationId, landing.operationalState));
  }

  return (
    <AccountAppearance><main className="mx-auto w-full max-w-2xl p-8">
      <div className="flex items-baseline justify-between">
        <PageHeading>Set up your business</PageHeading>
        <form action={signOutAction}>
          <Button type="submit" tone="text" size="small">
            Log out
          </Button>
        </form>
      </div>

      {/* **Founding is open again, and both doors are now open at once** (D29, amended). This
          page used to end here, with a sentence saying businesses are set up *for* you and
          nothing to press — which meant somebody who signed up had no way forward at all. The
          argument for closing it was about the *quality* of a self-served business, and what it
          actually produced was a door with nothing behind it. */}
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
    </main></AccountAppearance>
  );
}
