import { Badge, Stat, StatRow } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
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
      <Hint>
        {new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'full',
          timeZone: organization.timezone,
        }).format(new Date(`${date}T12:00:00Z`))}{' '}
        · times in {organization.timezone}
      </Hint>

      {/* **Two counts and no third.** How much is on today and how much is waiting are the two
          things this screen already answers in prose, said once at the top so the answer does
          not depend on scrolling. There is deliberately no *overdue*, no percentage and no
          comparison with yesterday: each would be the platform judging a day it knows nothing
          about, and a business that books a week ahead has a healthy pile of unscheduled work. */}
      <StatRow className="mt-4">
        <Stat label="Committed today" value={committed.length} />
        <Stat
          label="Waiting to be scheduled"
          value={unscheduled.length}
          note={unscheduled.length > 0 ? 'No time, or nobody assigned' : undefined}
        />
      </StatRow>

      <section className="mt-8">
        <SectionHeading>Committed today</SectionHeading>

        {committed.length === 0 ? (
          <EmptyState weight="subtle" className="mt-1">
            Nothing is scheduled for today.{' '}
            <Link
              href={`/organizations/${organizationId}/schedule`}
              className="underline underline-offset-4"
            >
              Open the schedule
            </Link>
          </EmptyState>
        ) : (
          <div className="mt-2">
            <DataTable
              rows={committed}
              rowKey={(booking) => booking.workItemId}
              empty="Nothing is scheduled for today."
              columns={[
                {
                  key: 'window',
                  header: 'When',
                  // I9: the instant is absolute in the database and rendered in the business's
                  // zone, never the server's or the reader's.
                  cell: (booking) => (
                    <span className="tabular-nums">
                      {formatWindow(booking.window, organization.timezone)}
                    </span>
                  ),
                },
                {
                  key: 'title',
                  header: 'Job',
                  emphasis: 'primary',
                  cell: (booking) => (
                    <Link
                      href={`/organizations/${organizationId}/work/${booking.workItemId}`}
                      className="underline underline-offset-4"
                    >
                      {booking.title}
                    </Link>
                  ),
                },
                {
                  key: 'status',
                  header: 'Stage',
                  // The tenant's own word for the state, read from the row and rendered as
                  // written (D6). Neutral, because the platform does not know what it means.
                  cell: (booking) => {
                    const label = byId.get(booking.workItemId)?.status.label;
                    return label ? <Badge>{label}</Badge> : null;
                  },
                },
                { key: 'resource', header: 'Who', cell: (booking) => booking.resource },
                {
                  key: 'where',
                  header: 'Customer and place',
                  emphasis: 'secondary',
                  cell: (booking) => {
                    const item = byId.get(booking.workItemId);
                    return (
                      [item?.customer?.label, item?.location?.label]
                        .filter(Boolean)
                        .join(' · ') || null
                    );
                  },
                },
              ]}
            />
          </div>
        )}
      </section>

      <Section className="mt-8">
        <SectionHeading>Waiting to be scheduled</SectionHeading>

        {unscheduled.length === 0 ? (
          <EmptyState weight="subtle" className="mt-1">Nothing is waiting.</EmptyState>
        ) : (
          <div className="mt-2">
            <DataTable
              rows={unscheduled.slice(0, 10)}
              rowKey={(item) => item.id}
              empty="Nothing is waiting."
              columns={[
                {
                  key: 'title',
                  header: 'Job',
                  emphasis: 'primary',
                  cell: (item) => (
                    <Link
                      href={`/organizations/${organizationId}/work/${item.id}`}
                      className="underline underline-offset-4"
                    >
                      {item.title}
                    </Link>
                  ),
                },
                {
                  key: 'status',
                  header: 'Stage',
                  cell: (item) => <Badge>{item.status.label}</Badge>,
                },
                {
                  key: 'customer',
                  header: 'Customer',
                  cell: (item) => item.customer?.label ?? null,
                },
              ]}
            />
          </div>
        )}

        {unscheduled.length > 10 ? (
          <Hint className="mt-3">
            <Link
              href={`/organizations/${organizationId}/work`}
              className="underline underline-offset-4"
            >
              {unscheduled.length - 10} more in Work
            </Link>
          </Hint>
        ) : null}
      </Section>
    </>
  );
}
