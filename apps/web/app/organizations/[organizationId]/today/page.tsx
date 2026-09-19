import { TodayDashboard } from '@/features/today/today-dashboard';
import { listAutomationRuns } from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import { listCalls } from '@/lib/domain/reception/calls';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { computeReadiness } from '@/lib/domain/tenancy/lifecycle';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { listRecentActivity } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Today acquires business state; the feature decides how that state reads as a cockpit. */
export default async function TodayPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/today'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const inSetup = organization.operationalState === 'setup';
  const date = todayInZone(organization.timezone);
  const within = zonedDayRange(date, organization.timezone);
  const [schedule, workItems, types, enabledModules, setupReadiness, activity] = await Promise.all([
    listSchedule(db, { organizationId, within, on: { date, timeZone: organization.timezone } }),
    listWorkItems(db, { organizationId }),
    listWorkItemTypes(db, { organizationId }),
    listUsableModules(db, { organizationId }),
    inSetup ? computeReadiness(db, { organizationId }) : Promise.resolve(null),
    listRecentActivity(db, { organizationId, limit: 50 }),
  ]);
  const automationsOn = enabledModules.has('automations');
  const receptionOn = enabledModules.has('reception');
  const [failedRuns, failedMessages, calls] = await Promise.all([
    automationsOn ? listAutomationRuns(db, { organizationId, failedOnly: true }) : Promise.resolve([]),
    automationsOn ? listMessageDeliveries(db, { organizationId, failedOnly: true }) : Promise.resolve([]),
    receptionOn ? listCalls(db, { organizationId }) : Promise.resolve([]),
  ]);
  const committed = schedule
    .flatMap((entry) =>
      entry.booked.map((booking) => ({ ...booking, resource: entry.resource.name })),
    )
    .sort((a, b) => a.window.startsAt.localeCompare(b.window.startsAt));
  const unscheduled = workItems.filter((item) => item.window === null);
  const todaysCalls = calls.filter((call) => call.startedAt >= within.startsAt && call.startedAt < within.endsAt);
  const requested = (await searchParams).widget;
  const open = Array.isArray(requested) ? requested[0] : requested;
  return (
    <TodayDashboard
      organizationId={organizationId}
      timezone={organization.timezone}
      date={date}
      inSetup={inSetup}
      typesConfigured={types.length > 0}
      open={open}
      committed={committed}
      unscheduled={unscheduled}
      workItems={workItems}
      setupRemaining={setupReadiness ? setupReadiness.blockers.length : null}
      activity={activity}
      failedRuns={failedRuns}
      failedMessages={failedMessages}
      todaysCalls={todaysCalls}
      unwrittenCalls={todaysCalls.filter((call) => call.outcome === null).length}
      automationsOn={automationsOn}
      receptionOn={receptionOn}
    />
  );
}
