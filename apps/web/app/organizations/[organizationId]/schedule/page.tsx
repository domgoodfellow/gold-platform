import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { EmptyState } from '@/components/surfaces/section';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { PageHeader } from '@/components/headers/page-header';
import { ScheduleConfiguration } from '@/features/scheduling/configuration/schedule-configuration';
import { ScheduleWorkspace } from '@/features/scheduling/calendar/schedule-workspace';
import {
  parseScheduleDate,
  parseScheduleResourceIds,
  parseScheduleView,
} from '@/features/scheduling/calendar/schedule-url';
import { listScheduleDays } from '@/lib/domain/scheduling/availability';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import { describeShortfall, evaluateWorkItems } from '@/lib/domain/work-items/requirements';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { startOfMonth, todayInZone } from '@/lib/domain/scheduling/window';
import { calendarDates } from '@/components/calendar/calendar-period';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * The calendar, which `domain-model.md` insists is a view rather than an entity:
 *
 *   > It is Work Items organised by time and resource, which is the scheduling core reading
 *   > its own rows back. A `calendar` table would be a second place a scheduled thing could
 *   > live, and the two would disagree the first time one was written without the other.
 *
 * So there is no calendar table, no cached day, and no denormalised slot — every window below is
 * derived on read, through `listScheduleDays` (I5), advisory until the exclusion constraint
 * re-asserts it at the moment of booking (I6). This route only resolves the URL (`view`, `on`,
 * `resource`), loads that day or week, and hands the result to `ScheduleWorkspace`, which is the
 * whole of what Schedule looks like.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/schedule'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  // The sidebar withholds Schedule from a business that has declared no work as scheduled, but a
  // hidden row is not a closed door — this address still answers, and says why there is nothing
  // here rather than drawing an empty calendar or pretending the page is forbidden.
  if (!(await hasSchedulableWork(db, { organizationId }))) {
    const mayConfigureWork = organization.capabilities.includes('field.manage');
    return (
      <AppPage>
        <PageHeader title={areaLabel('schedule')} crumbs={workspaceAncestry(organizationId, 'schedule')} />
        <EmptyState
          title="No work here is scheduled"
          description="Schedule shows work that happens at a time. None of this business's kinds of work is set up that way yet."
          action={
            mayConfigureWork ? (
              <Link href={`/organizations/${organizationId}/work/configuration`} className="underline underline-offset-4">
                Choose which work is scheduled
              </Link>
            ) : undefined
          }
        />
      </AppPage>
    );
  }

  const today = todayInZone(organization.timezone);
  const view = parseScheduleView(query.view);
  const date = parseScheduleDate(query.on, today);
  const selectedResourceIds = parseScheduleResourceIds(query.resource);

  const monthStart = startOfMonth(date);
  const dates = calendarDates(view, date);

  const mayConfigure = organization.capabilities.includes('field.manage');
  const mayAddResource = organization.capabilities.includes('resource.create');
  const resourcesHref = `/organizations/${organizationId}/resources`;

  // Hours are read for every viewer, not only one who may configure them: whether this business
  // has configured anything at all changes what Day view is honest to draw (see `DaySchedule`).
  const [days, hours] = await Promise.all([
    listScheduleDays(db, { organizationId, dates, timeZone: organization.timezone }),
    listOperatingHours(db, { organizationId }),
  ]);

  // What each scheduled job is short of, from its kind's requirements and who is on it — derived on this
  // read. A short job is still on the board; this only says what it lacks.
  const scheduled = new Map<string, { workItemId: string; typeId: string; resourceIds: string[] }>();
  for (const day of days) {
    for (const entry of day.resources) {
      for (const booking of entry.booked) {
        scheduled.set(booking.workItemId, { workItemId: booking.workItemId, typeId: booking.typeId, resourceIds: booking.resourceIds });
      }
    }
    for (const work of day.unassigned) {
      scheduled.set(work.workItemId, { workItemId: work.workItemId, typeId: work.typeId, resourceIds: [] });
    }
  }
  const evaluations = await evaluateWorkItems(db, { organizationId, items: [...scheduled.values()] });
  const shortfalls: Record<string, string> = {};
  for (const [workItemId, evaluation] of evaluations) {
    const shortfall = describeShortfall(evaluation, RESOURCE_CLASS_LABELS);
    if (shortfall) shortfalls[workItemId] = shortfall;
  }

  const allResources = days[0]?.resources.map((entry) => entry.resource) ?? [];
  const visibleDays = days.map((day) => ({
    ...day,
    resources:
      selectedResourceIds.length === 0
        ? day.resources
        : day.resources.filter((entry) => selectedResourceIds.includes(entry.resource.id)),
    // A board filtered to particular resources is about them; work nobody is on belongs to none of them.
    unassigned: selectedResourceIds.length === 0 ? day.unassigned : [],
  }));

  return (
    <AppPage className="flex h-full min-h-0 flex-1 flex-col">
      {mayConfigure ? (
        <ConfigureRegistrar
          title="Schedule configuration"
          settingsHref={`/organizations/${organizationId}/schedule/configuration`}
        >
          <ScheduleConfiguration
            organizationId={organizationId}
            role={organization.role}
            mayConfigure={mayConfigure}
            hours={hours}
            timezone={organization.timezone}
            bufferMinutes={organization.bufferMinutes}
          />
        </ConfigureRegistrar>
      ) : null}

      {/* I9: every window drawn below is an absolute instant rendered in this business's own
          zone, so naming the zone is part of reading the page rather than decoration. */}
      <PageHeader
        title={areaLabel('schedule')}
        crumbs={workspaceAncestry(organizationId, 'schedule')}
        meta={
          <>
            Times shown in {organization.timezone} ·{' '}
            <Link
              href={`/organizations/${organizationId}/schedule/configuration`}
              className="underline underline-offset-4"
            >
              Opening hours
            </Link>
          </>
        }
        configure={mayConfigure}
      />

      <ScheduleWorkspace
        organizationId={organizationId}
        view={view}
        date={date}
        today={today}
        timezone={organization.timezone}
        days={visibleDays}
        monthDate={monthStart}
        allResources={allResources}
        selectedResourceIds={selectedResourceIds}
        hasConfiguredHours={hours.length > 0}
        shortfalls={shortfalls}
        resourcesHref={resourcesHref}
        mayAddResource={mayAddResource}
      />
    </AppPage>
  );
}
