import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import {
  AddOperatingHoursForm,
  OperatingHoursRow,
  OrganizationSettingsForm,
} from './settings-forms';

export const dynamic = 'force-dynamic';

/**
 * What a business has told the platform about itself.
 *
 * Everything on this page is configuration a tenant owns, and none of it has a value the
 * platform chose. In particular the opening hours start **empty**: there is no seeded working
 * week, because a business that has said nothing about its hours has not said it is closed,
 * and inventing a nine-to-five would be the hardcoded business hours `constraints.md` forbids.
 */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/sign-in');
    }
    throw error;
  }

  const organization = await getOrganization(db, organizationId);
  if (!organization) {
    notFound();
  }

  const hours = await listOperatingHours(db, { organizationId });

  const mayManage = organization.capabilities.includes('organization.manage');
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Settings</h1>
      <p className="text-sm opacity-70">{organization.name}</p>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">This business</h2>
        <p className="mt-1 text-sm opacity-70">
          Changing the currency does not reinterpret what past jobs cost, and changing the
          timezone does not move any booking — each amount carries the currency it was
          recorded in, and every scheduled window is an absolute instant.
        </p>

        {mayManage ? (
          <OrganizationSettingsForm
            organizationId={organizationId}
            name={organization.name}
            timezone={organization.timezone}
            currency={organization.currency}
          />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            Your role, {organization.role}, cannot change these.
          </p>
        )}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Opening hours</h2>
        <p className="mt-1 text-sm opacity-70">
          {hours.length === 0
            ? 'None set, so the schedule treats every hour as available. Nothing here is assumed — which days this business works, and when, are yours to say.'
            : `Used by the schedule to work out what is free. Times are read in ${organization.timezone}.`}
        </p>

        {hours.length > 0 ? (
          <div className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {hours.map((entry) =>
              mayConfigure ? (
                <OperatingHoursRow
                  key={entry.id}
                  organizationId={organizationId}
                  hours={entry}
                />
              ) : (
                <p key={entry.id} className="py-2 text-sm opacity-70">
                  {entry.opensAt.slice(0, 5)}–{entry.closesAt.slice(0, 5)}
                </p>
              ),
            )}
          </div>
        ) : null}

        {mayConfigure ? (
          <AddOperatingHoursForm organizationId={organizationId} />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            Your role, {organization.role}, cannot set opening hours.
          </p>
        )}
      </section>
    </main>
  );
}
