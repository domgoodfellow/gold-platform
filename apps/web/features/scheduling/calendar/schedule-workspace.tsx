import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { DaySchedule } from './day-schedule';
import { WeekSchedule } from './week-schedule';
import { MonthSchedule } from './month-schedule';
import { ScheduleResourceFilter } from './schedule-resource-filter';
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace';
import type { ScheduleView } from './schedule-url';

/**
 * The Schedule workspace: view navigation and the resource filter share a row, the toolbar sits
 * beneath it, and the board — Day, Week or Month — fills the rest of the available height. The
 * route loads the data and resolves the URL into `view`/`date`/`selectedResourceIds`; everything
 * below this line is what Schedule actually looks like. The board itself is the primary content:
 * it fills the workspace and is never replaced by an empty-state sentence, even with zero
 * Resources and zero Work items (`CLAUDE.md`'s empty-state rules) — see `DaySchedule` and
 * `WeekSchedule` for what each draws instead.
 */
export function ScheduleWorkspace({
  organizationId,
  view,
  date,
  today,
  timezone,
  days,
  monthDate,
  allResources,
  selectedResourceIds,
  hasConfiguredHours,
  shortfalls,
  resourcesHref,
  mayAddResource,
  hoursHref = null,
}: {
  organizationId: string;
  view: ScheduleView;
  date: string;
  /** Today in the organization's own timezone — the one "current day" every board highlights from. */
  today: string;
  timezone: string;
  /** Already filtered to `selectedResourceIds` — one entry for Day, seven for Week, forty-two for Month. */
  days: ScheduleDay[];
  /** The first of the viewed month — only meaningful, and only required, for Month. */
  monthDate?: string;
  /** Every Resource this organization has, unfiltered — what the filter itself offers to choose from. */
  allResources: { id: string; name: string }[];
  selectedResourceIds: readonly string[];
  hasConfiguredHours: boolean;
  /** What each scheduled job is short of, by work item id — only jobs that are short appear. Never hides an entry. */
  shortfalls: Readonly<Record<string, string>>;
  /** Where Day's zero-Resource state sends a dispatcher to add one. */
  resourcesHref: string;
  mayAddResource: boolean;
  /** The opening-hours editor, for someone who may change hours. */
  hoursHref?: string | null;
}) {
  const activeDay = days.find((day) => day.date === date) ?? days[0];

  return (
    <CalendarWorkspace
      basePath={`/organizations/${organizationId}/schedule`}
      view={view}
      date={date}
      today={today}
      filters={{ resource: selectedResourceIds }}
      filterControls={<ScheduleResourceFilter organizationId={organizationId} view={view} date={date} resources={allResources} selectedIds={selectedResourceIds} />}
    >
        {view === 'week' ? (
          <WeekSchedule organizationId={organizationId} days={days} today={today} timezone={timezone} shortfalls={shortfalls} />
        ) : view === 'month' ? (
          <MonthSchedule
            organizationId={organizationId}
            days={days}
            monthDate={monthDate ?? date}
            today={today}
            resourceIds={selectedResourceIds}
            shortfalls={shortfalls}
          />
        ) : (
          <DaySchedule
            organizationId={organizationId}
            date={activeDay.date}
            within={activeDay.within}
            open={activeDay.open}
            resources={activeDay.resources}
            unassigned={activeDay.unassigned}
            resourceNames={new Map(allResources.map((resource) => [resource.id, resource.name]))}
            shortfalls={shortfalls}
            hasConfiguredHours={hasConfiguredHours}
            timezone={timezone}
            resourcesHref={resourcesHref}
            mayAddResource={mayAddResource}
            hoursHref={hoursHref}
          />
        )}
    </CalendarWorkspace>
  );
}
