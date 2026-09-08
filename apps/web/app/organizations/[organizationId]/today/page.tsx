import { Badge } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { DividedList, EmptyState } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { Widget, WidgetGrid, WidgetPanel } from '@/components/display/widget';
import Link from 'next/link';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { formatWindow, todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** How many rows a tile previews before *open it* is the better answer. */
const PREVIEW = 4;

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
 *
 * **It is the first screen built as a dashboard of widgets** (`components/display/widget.tsx`).
 * Each tile shows its figure and the first few rows behind it; opening one gives the whole
 * table. What it replaced was two counts at the top and two tables below them, where the second
 * table was cut off at ten rows with *N more in Work* underneath — the same idea, without a way
 * to see the rest without leaving the screen.
 */
export default async function TodayPage({
  params,
  searchParams,
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

  const area = `/organizations/${organizationId}/today`;
  const workHref = (id: string) => `/organizations/${organizationId}/work/${id}`;
  const { widget } = await searchParams;
  const open = Array.isArray(widget) ? widget[0] : widget;

  const dateLine = (
    <Hint>
      {new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'full',
        timeZone: organization.timezone,
      }).format(new Date(`${date}T12:00:00Z`))}{' '}
      · times in {organization.timezone}
    </Hint>
  );

  // I9 throughout: the instant is absolute in the database and rendered in the business's zone,
  // never the server's or the reader's.
  const committedTable = (
    <DataTable
      rows={committed}
      rowKey={(booking) => booking.workItemId}
      empty="Nothing is scheduled for today."
      columns={[
        {
          key: 'window',
          header: 'When',
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
            <Link href={workHref(booking.workItemId)} className="underline underline-offset-4">
              {booking.title}
            </Link>
          ),
        },
        {
          key: 'status',
          header: 'Stage',
          // The tenant's own word for the state, read from the row and rendered as written
          // (D6). Neutral, because the platform does not know what it means.
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
              [item?.customer?.label, item?.location?.label].filter(Boolean).join(' · ') || null
            );
          },
        },
      ]}
    />
  );

  const waitingTable = (
    <DataTable
      rows={unscheduled}
      rowKey={(item) => item.id}
      empty="Nothing is waiting."
      columns={[
        {
          key: 'title',
          header: 'Job',
          emphasis: 'primary',
          cell: (item) => (
            <Link href={workHref(item.id)} className="underline underline-offset-4">
              {item.title}
            </Link>
          ),
        },
        { key: 'status', header: 'Stage', cell: (item) => <Badge>{item.status.label}</Badge> },
        { key: 'customer', header: 'Customer', cell: (item) => item.customer?.label ?? null },
      ]}
    />
  );

  if (open === 'committed' || open === 'waiting') {
    const committedOpen = open === 'committed';
    return (
      <>
        {dateLine}
        <WidgetPanel
          title={committedOpen ? 'Committed today' : 'Waiting to be scheduled'}
          backHref={area}
          backLabel="Today"
        >
          {committedOpen ? committedTable : waitingTable}
        </WidgetPanel>
      </>
    );
  }

  return (
    <>
      {dateLine}

      {/* **Two tiles and no third.** How much is on today and how much is waiting are the two
          questions this screen answers. There is deliberately no *overdue*, no percentage and no
          comparison with yesterday: each would be the platform judging a day it knows nothing
          about, and a business that books a week ahead has a healthy pile of unscheduled work. */}
      <WidgetGrid className="mt-4">
        <Widget
          title="Committed today"
          value={committed.length}
          href={committed.length > 0 ? `${area}?widget=committed` : undefined}
        >
          {committed.length === 0 ? (
            <EmptyState weight="subtle">
              Nothing is scheduled for today.{' '}
              <Link
                href={`/organizations/${organizationId}/schedule`}
                className="underline underline-offset-4"
              >
                Open the schedule
              </Link>
            </EmptyState>
          ) : (
            <DividedList className="text-sm">
              {committed.slice(0, PREVIEW).map((booking) => (
                <li key={booking.workItemId} className="flex items-baseline gap-2 py-1.5">
                  <span className="shrink-0 tabular-nums text-muted">
                    {formatWindow(booking.window, organization.timezone)}
                  </span>
                  <Link
                    href={workHref(booking.workItemId)}
                    className="min-w-0 truncate underline underline-offset-4"
                  >
                    {booking.title}
                  </Link>
                </li>
              ))}
            </DividedList>
          )}
        </Widget>

        <Widget
          title="Waiting to be scheduled"
          value={unscheduled.length}
          note={unscheduled.length > 0 ? 'No time, or nobody assigned' : undefined}
          href={unscheduled.length > 0 ? `${area}?widget=waiting` : undefined}
        >
          {unscheduled.length === 0 ? (
            <EmptyState weight="subtle">Nothing is waiting.</EmptyState>
          ) : (
            <DividedList className="text-sm">
              {unscheduled.slice(0, PREVIEW).map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 py-1.5">
                  <Link
                    href={workHref(item.id)}
                    className="min-w-0 truncate underline underline-offset-4"
                  >
                    {item.title}
                  </Link>
                  <span className="ml-auto shrink-0 text-muted">{item.customer?.label}</span>
                </li>
              ))}
            </DividedList>
          )}
        </Widget>
      </WidgetGrid>
    </>
  );
}
