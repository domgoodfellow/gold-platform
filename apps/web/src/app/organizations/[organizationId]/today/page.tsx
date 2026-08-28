import Link from 'next/link';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { formatWindow, todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * What to do next.
 *
 * D23 says a phone screen is designed around one action, and that for an operator the action
 * is *what do I do next*. This is that screen, and it is deliberately not the schedule: the
 * schedule answers "who is free when", per resource, which is a dispatcher's question. This
 * answers "what is happening today", in time order, merged across every resource — which is
 * the question the person doing the work asks, and for an owner-operator who is also the
 * technician those are the same person at different moments of the day.
 *
 * **It computes nothing.** Every window here comes from `listSchedule`, the one availability
 * calculation (I5), read and flattened. A second notion of "today's work" that filtered
 * `work_items` directly would be exactly the second answer that invariant exists to forbid,
 * and it would drift the first time the constraint learned something new — as it did in the
 * slice that made a cancelled job release its resource.
 */
export default async function TodayPage({
  params,
}: PageProps<'/organizations/[organizationId]/today'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // This business's today, not the server's. A tenant in Auckland and one in Montréal are on
  // different dates for most of the server's day (I9).
  const date = todayInZone(organization.timezone);
  const within = zonedDayRange(date, organization.timezone);

  const [schedule, all] = await Promise.all([
    listSchedule(db, {
      organizationId,
      within,
      on: { date, timeZone: organization.timezone },
    }),
    listWorkItems(db, { organizationId }),
  ]);

  // One chronological list across every resource. `listSchedule` returns per resource because
  // that is what the schedule grid draws; the merge is presentation, not a second calculation.
  const committed = schedule
    .flatMap((entry) =>
      entry.booked.map((booking) => ({ ...booking, resource: entry.resource.name })),
    )
    .sort((a, b) => a.window.startsAt.localeCompare(b.window.startsAt));

  const byId = new Map(all.map((item) => [item.id, item]));

  // Work that exists and has no time or nobody to do it. Not a warning and not a count of
  // problems — a business that books a week ahead has a healthy pile here.
  const unscheduled = all.filter((item) => item.window === null);

  return (
    <>
      <p className="text-sm opacity-70">
        {new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'full',
          timeZone: organization.timezone,
        }).format(new Date(`${date}T12:00:00Z`))}{' '}
        · times in {organization.timezone}
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Committed today</h2>

        {committed.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">
            Nothing is scheduled for today.{' '}
            <Link
              href={`/organizations/${organizationId}/schedule`}
              className="underline underline-offset-4"
            >
              Open the schedule
            </Link>
          </p>
        ) : (
          <ol className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {committed.map((booking) => {
              const item = byId.get(booking.workItemId);
              return (
                <li key={booking.workItemId} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm tabular-nums opacity-70">
                      {formatWindow(booking.window, organization.timezone)}
                    </span>
                    <Link
                      href={`/organizations/${organizationId}/work/${booking.workItemId}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {booking.title}
                    </Link>
                  </div>
                  <div className="mt-0.5 text-sm opacity-70">
                    {[
                      booking.resource,
                      // The tenant's own word for the state, read from the row (D6).
                      item?.status.label,
                      item?.customer?.label,
                      item?.location?.label,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Waiting to be scheduled</h2>

        {unscheduled.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">Nothing is waiting.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {unscheduled.slice(0, 10).map((item) => (
              <li key={item.id} className="py-2">
                <Link
                  href={`/organizations/${organizationId}/work/${item.id}`}
                  className="text-sm font-medium underline underline-offset-4"
                >
                  {item.title}
                </Link>
                <div className="text-sm opacity-70">
                  {[item.status.label, item.customer?.label].filter(Boolean).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        )}

        {unscheduled.length > 10 ? (
          <p className="mt-3 text-sm opacity-70">
            <Link
              href={`/organizations/${organizationId}/work`}
              className="underline underline-offset-4"
            >
              {unscheduled.length - 10} more in Work
            </Link>
          </p>
        ) : null}
      </section>
    </>
  );
}
