import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { formatWindow, todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';

export const dynamic = 'force-dynamic';

/**
 * The calendar, which `domain-model.md` insists is a view rather than an entity:
 *
 *   > It is Work Items organised by time and resource, which is the scheduling core reading
 *   > its own rows back. A `calendar` table would be a second place a scheduled thing could
 *   > live, and the two would disagree the first time one was written without the other.
 *
 * So there is no calendar table, no cached day, and no denormalised slot. Everything on this
 * page is derived on read from `work_items`, and the free time is `freeWindows` — the one
 * availability calculation (I5), whose answer is advisory (I6) and is re-asserted by the
 * exclusion constraint when a dispatcher actually commits.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/schedule'>) {
  const { organizationId } = await params;
  const { on } = await searchParams;
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

  // Which day, as this business reads a day — not as the server does. A tenant in Auckland
  // and one in Los Angeles are on different dates for most of the server's day.
  const requested = typeof on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null;
  const date = requested ?? todayInZone(organization.timezone);
  const within = zonedDayRange(date, organization.timezone);

  // `on` is what lets the calculation subtract this business's opening hours. Given together
  // because an hours rule is a recurring local reading and needs both to become instants.
  const schedule = await listSchedule(db, {
    organizationId,
    within,
    on: { date, timeZone: organization.timezone },
  });

  const shift = (days: number) => {
    const moved = new Date(`${date}T00:00:00Z`);
    moved.setUTCDate(moved.getUTCDate() + days);
    return moved.toISOString().slice(0, 10);
  };

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <Link
          href={`/organizations/${organizationId}/settings`}
          className="text-sm underline underline-offset-4 opacity-70"
        >
          Opening hours
        </Link>
      </div>
      <p className="text-sm opacity-70">
        {organization.name} · {organization.timezone}
      </p>

      <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Day">
        <Link
          href={`/organizations/${organizationId}/schedule?on=${shift(-1)}`}
          className="rounded border border-black/15 px-3 py-1 dark:border-white/20"
        >
          ← Previous
        </Link>
        <span className="font-medium">{date}</span>
        <Link
          href={`/organizations/${organizationId}/schedule?on=${shift(1)}`}
          className="rounded border border-black/15 px-3 py-1 dark:border-white/20"
        >
          Next →
        </Link>
      </nav>

      {schedule.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">
          Nothing to schedule against yet. A resource is whoever or whatever work occupies for
          a window — a technician, a van, a machine.
        </p>
      ) : (
        schedule.map((entry) => (
          <section key={entry.resource.id} className="mt-6">
            <h2 className="text-sm font-medium">{entry.resource.name}</h2>

            {entry.booked.length === 0 ? (
              <p className="mt-1 text-sm opacity-60">Nothing booked.</p>
            ) : (
              <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
                {entry.booked.map((booking) => (
                  <li key={booking.workItemId} className="py-2">
                    <div className="font-medium">{booking.title}</div>
                    <div className="text-sm opacity-70">
                      {formatWindow(booking.window, organization.timezone)}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Advisory, and labelled as such, because it is (I6). By the time anyone acts on
                it the world may have moved; the exclusion constraint is what decides. */}
            {/* Free time is what the business is open for, minus what is committed. With no
                opening hours set that is the whole day — "no claim" rather than "closed". */}
            <p className="mt-2 text-sm opacity-60">
              Free (advisory):{' '}
              {entry.free.length === 0
                ? 'nothing left today'
                : entry.free
                    .map((window) => formatWindow(window, organization.timezone))
                    .join(' · ')}
            </p>
          </section>
        ))
      )}
    </main>
  );
}
