import { Badge } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { DividedList, EmptyState } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { Widget, WidgetGrid, WidgetPanel } from '@/components/display/widget';
import Link from 'next/link';
import { listAutomationRuns } from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import { listCalls } from '@/lib/domain/reception/calls';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { formatWindow, todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { computeReadiness } from '@/lib/domain/tenancy/lifecycle';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';
import { listRecentActivity } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** How many rows a tile previews before *open it* is the better answer. */
const PREVIEW = 4;

/**
 * The operational cockpit: what is happening, what is waiting, what changed, and whether
 * anything the business switched on is not working — using only what is already true, never a
 * judgment invented for this screen.
 *
 * **It still computes nothing of its own.** Committed and waiting come from `listSchedule`
 * exactly as before (I5); readiness comes from `computeReadiness`, Slice 1's own mechanism,
 * unmodified; failures come from `listAutomationRuns`/`listMessageDeliveries`, their own
 * tables' one reader each; activity comes from `listRecentActivity`, which shares its
 * interpretive core with the customer timeline rather than inventing a second one. Every widget
 * here is a rendering of a fact that already has exactly one source.
 *
 * **Lifecycle changes composition, not queries.** A SETUP business sees its own readiness first
 * — blockers, warnings, a link to Business Setup — because there is nothing yet to call
 * "complete", only "ready to launch" or not; the deliberate act stays deliberate (Slice 1). A
 * LIVE business sees its operations first, because Setup's own question has already been
 * answered. Every operational widget below is eligible on whether its module is switched on,
 * never on whether it currently has anything to show — a business with zero automation failures
 * is not a business without the automations module.
 */
export default async function TodayPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/today'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const inSetup = organization.operationalState === 'setup';

  // This business's today, not the server's. A tenant in Auckland and one in Montréal are on
  // different dates for most of the server's day (I9).
  const date = todayInZone(organization.timezone);
  const within = zonedDayRange(date, organization.timezone);

  const [schedule, all, types, enabledModules, readiness, activity] = await Promise.all([
    listSchedule(db, {
      organizationId,
      within,
      on: { date, timeZone: organization.timezone },
    }),
    listWorkItems(db, { organizationId }),
    listWorkItemTypes(db, { organizationId }),
    listEnabledModules(db, { organizationId }),
    // Only asked while there is a launch ahead of it — a live business has nothing here to
    // compute, and asking would be a second opinion nobody would ever read (Slice 1).
    inSetup ? computeReadiness(db, { organizationId }) : Promise.resolve(null),
    listRecentActivity(db, { organizationId, limit: 50 }),
  ]);

  const automationsOn = enabledModules.has('automations');
  const receptionOn = enabledModules.has('reception');

  const [failedRuns, failedMessages, calls] = await Promise.all([
    automationsOn
      ? listAutomationRuns(db, { organizationId, failedOnly: true })
      : Promise.resolve([]),
    automationsOn
      ? listMessageDeliveries(db, { organizationId, failedOnly: true })
      : Promise.resolve([]),
    receptionOn ? listCalls(db, { organizationId }) : Promise.resolve([]),
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

  // The same simple range filter the Calls area itself uses — not a second calculation, a
  // narrowing of rows already read under the same authorization `listCalls` already applies.
  const todaysCalls = calls.filter(
    (call) => call.startedAt >= within.startsAt && call.startedAt < within.endsAt,
  );
  const unwrittenCalls = calls.filter((call) => call.outcome === null).length;

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

  const activityTable = (
    <DataTable
      rows={activity}
      rowKey={(entry) => entry.id}
      empty="No activity yet."
      columns={[
        {
          key: 'when',
          header: 'When',
          cell: (entry) => (
            <span className="tabular-nums">
              {new Intl.DateTimeFormat('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: organization.timezone,
              }).format(new Date(entry.occurredAt))}
            </span>
          ),
        },
        {
          key: 'description',
          header: 'What happened',
          emphasis: 'primary',
          cell: (entry) => entry.description,
        },
        {
          key: 'actor',
          header: 'Who',
          emphasis: 'secondary',
          cell: (entry) => entry.actorName ?? 'A former member',
        },
      ]}
    />
  );

  if (open === 'committed' || open === 'waiting' || open === 'activity') {
    const title =
      open === 'committed'
        ? 'Committed today'
        : open === 'waiting'
          ? 'Waiting to be scheduled'
          : 'Recent activity';
    const body = open === 'committed' ? committedTable : open === 'waiting' ? waitingTable : activityTable;

    return (
      <>
        {dateLine}
        <WidgetPanel title={title} backHref={area} backLabel="Today">
          {body}
        </WidgetPanel>
      </>
    );
  }

  const readinessWidget =
    inSetup && readiness ? (
      <Widget
        key="readiness"
        title="Setup readiness"
        href={`/organizations/${organizationId}/setup`}
        value={readiness.blockers.length === 0 ? 'Ready to launch' : 'Not ready to launch'}
        note={`${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? '' : 's'} · ${readiness.warnings.length} warning${readiness.warnings.length === 1 ? '' : 's'}`}
        wide
      >
        {readiness.blockers.length === 0 && readiness.warnings.length === 0 ? (
          <EmptyState weight="subtle">
            Nothing outstanding. Launching is still a deliberate step, from Business Setup.
          </EmptyState>
        ) : (
          <DividedList className="text-sm">
            {[...readiness.blockers, ...readiness.warnings].slice(0, PREVIEW).map((item) => (
              <li key={item.key} className="flex items-baseline gap-2 py-1.5">
                <Badge>{readiness.blockers.includes(item) ? 'Blocker' : 'Warning'}</Badge>
                <span className="min-w-0 truncate">{item.message}</span>
              </li>
            ))}
          </DividedList>
        )}
      </Widget>
    ) : null;

  const activityWidget = (
    <Widget
      key="activity"
      title="Recent activity"
      href={activity.length > 0 ? `${area}?widget=activity` : undefined}
      wide
    >
      {activity.length === 0 ? (
        <EmptyState weight="subtle">No activity yet.</EmptyState>
      ) : (
        <DividedList className="text-sm">
          {activity.slice(0, PREVIEW).map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-2 py-1.5">
              <span className="shrink-0 tabular-nums text-muted">
                {new Intl.DateTimeFormat('en-GB', {
                  timeStyle: 'short',
                  timeZone: organization.timezone,
                }).format(new Date(entry.occurredAt))}
              </span>
              <span className="min-w-0 truncate">{entry.description}</span>
            </li>
          ))}
        </DividedList>
      )}
    </Widget>
  );

  const committedWidget = (
    <Widget
      key="committed"
      title="Committed today"
      value={committed.length}
      href={committed.length > 0 ? `${area}?widget=committed` : undefined}
    >
      {committed.length === 0 ? (
        <EmptyState weight="subtle">
          There is nothing scheduled today.{' '}
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
  );

  const waitingWidget = (
    <Widget
      key="waiting"
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
  );

  // **Eligible on the module, never on the count.** A business with automations on and zero
  // failures today is not a business without the module — it is shown "0", the same way
  // Committed today is shown "0" for a quiet afternoon.
  const failedAutomationsWidget = automationsOn ? (
    <Widget
      key="failed-automations"
      title="Failed automations"
      value={failedRuns.length}
      href={`/organizations/${organizationId}/automations`}
    >
      {failedRuns.length === 0 ? (
        <EmptyState weight="subtle">No failures.</EmptyState>
      ) : (
        <DividedList className="text-sm">
          {failedRuns.slice(0, PREVIEW).map((run) => (
            <li key={run.id} className="py-1.5">
              <div className="truncate">{run.ruleName}</div>
              {run.detail ? (
                <div className="truncate text-xs text-muted">{run.detail}</div>
              ) : null}
            </li>
          ))}
        </DividedList>
      )}
    </Widget>
  ) : null;

  const failedMessagesWidget = automationsOn ? (
    <Widget
      key="failed-messages"
      title="Failed messages"
      value={failedMessages.length}
      href={`/organizations/${organizationId}/automations`}
    >
      {failedMessages.length === 0 ? (
        <EmptyState weight="subtle">No failures.</EmptyState>
      ) : (
        <DividedList className="text-sm">
          {failedMessages.slice(0, PREVIEW).map((message) => (
            <li key={message.id} className="py-1.5">
              <div className="truncate">
                {message.channel} to {message.recipient}
              </div>
              {message.detail ? (
                <div className="truncate text-xs text-muted">{message.detail}</div>
              ) : null}
            </li>
          ))}
        </DividedList>
      )}
    </Widget>
  ) : null;

  const callsWidget = receptionOn ? (
    <Widget
      key="calls"
      title="Calls"
      value={todaysCalls.length}
      note={unwrittenCalls > 0 ? `${unwrittenCalls} not written up` : undefined}
      href={`/organizations/${organizationId}/calls`}
    >
      {todaysCalls.length === 0 ? (
        <EmptyState weight="subtle">No calls today.</EmptyState>
      ) : (
        <DividedList className="text-sm">
          {todaysCalls.slice(0, PREVIEW).map((call) => (
            <li key={call.id} className="flex items-baseline gap-2 py-1.5">
              <span className="min-w-0 truncate">
                {call.direction === 'inbound' ? 'Inbound' : 'Outbound'} · {call.toNumber}
              </span>
              <span className="ml-auto shrink-0 text-muted">
                {call.outcome?.name ?? call.status.replace('_', ' ')}
              </span>
            </li>
          ))}
        </DividedList>
      )}
    </Widget>
  ) : null;

  const operationalWidgets = [
    committedWidget,
    waitingWidget,
    failedAutomationsWidget,
    failedMessagesWidget,
    callsWidget,
  ].filter(Boolean);

  return (
    <>
      {dateLine}

      {/* A business with no kinds of work yet cannot have anything committed or waiting, so
          both tiles below would read zero regardless — which looked identical to "nothing due
          today" and left a brand-new organization with nowhere to go from this screen (product
          reality audit, Slice B). This names the actual state and points at the screen where it
          stops being true, rather than advising — `work/page.tsx` owns the same sentence for the
          same reason. */}
      {types.length === 0 ? (
        <EmptyState className="mt-4">
          No kinds of work defined yet.{' '}
          <Link
            href={`/organizations/${organizationId}/work`}
            className="underline underline-offset-4"
          >
            Start in Work
          </Link>
        </EmptyState>
      ) : null}

      {/* **Lifecycle decides composition, not queries.** A SETUP business meets its own
          readiness and what has happened so far before anything operational; a LIVE business
          meets its operations first, because Setup's question is already answered (product
          reality audit, Slice 2). */}
      {inSetup ? (
        <WidgetGrid className="mt-4">
          {readinessWidget}
          {activityWidget}
          {operationalWidgets}
        </WidgetGrid>
      ) : (
        <WidgetGrid className="mt-4">
          {operationalWidgets}
          {activityWidget}
        </WidgetGrid>
      )}
    </>
  );
}
