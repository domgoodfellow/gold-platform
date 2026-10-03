import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
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
import { isoDayOfWeek, shiftDate, startOfMonth, todayInZone } from '@/lib/domain/scheduling/window';
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

  const today = todayInZone(organization.timezone);
  const view = parseScheduleView(query.view);
  const date = parseScheduleDate(query.on, today);
  const selectedResourceIds = parseScheduleResourceIds(query.resource);

  // Week is the ISO week (Monday first) containing the selected day — the same numbering
  // opening hours already use, so there is one answer to "which day is that" across the feature.
  const weekStart = shiftDate(date, -(isoDayOfWeek(date) - 1));
  // Month is a coarser projection of the same Work Items: six full ISO weeks (42 tenant calendar
  // days, Monday first) spanning the viewed month plus whatever lead/trail days complete the
  // grid — never a second availability calculation, and never a calendar entity.
  const monthStart = startOfMonth(date);
  const monthGridStart = shiftDate(monthStart, -(isoDayOfWeek(monthStart) - 1));
  const dates =
    view === 'week'
      ? Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index))
      : view === 'month'
        ? Array.from({ length: 42 }, (_, index) => shiftDate(monthGridStart, index))
        : [date];

  const mayConfigure = organization.capabilities.includes('field.manage');
  const mayAddResource = organization.capabilities.includes('resource.create');
  const resourcesHref = `/organizations/${organizationId}/resources`;

  // Hours are read for every viewer, not only one who may configure them: whether this business
  // has configured anything at all changes what Day view is honest to draw (see `DaySchedule`).
  const [days, hours] = await Promise.all([
    listScheduleDays(db, { organizationId, dates, timeZone: organization.timezone }),
    listOperatingHours(db, { organizationId }),
  ]);

  const allResources = days[0]?.resources.map((entry) => entry.resource) ?? [];
  const visibleDays = days.map((day) => ({
    ...day,
    resources:
      selectedResourceIds.length === 0
        ? day.resources
        : day.resources.filter((entry) => selectedResourceIds.includes(entry.resource.id)),
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
        resourcesHref={resourcesHref}
        mayAddResource={mayAddResource}
      />
    </AppPage>
  );
}
