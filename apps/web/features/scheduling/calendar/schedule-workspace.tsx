import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { DaySchedule } from './day-schedule';
import { WeekSchedule } from './week-schedule';
import { MonthSchedule } from './month-schedule';
import { ScheduleResourceFilter } from './schedule-resource-filter';
import { ScheduleToolbar } from './schedule-toolbar';
import { ScheduleViewNav } from './schedule-view-nav';
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
  resourcesHref,
  mayAddResource,
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
  /** Where Day's zero-Resource state sends a dispatcher to add one. */
  resourcesHref: string;
  mayAddResource: boolean;
}) {
  const activeDay = days.find((day) => day.date === date) ?? days[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScheduleViewNav organizationId={organizationId} view={view} date={date} resourceIds={selectedResourceIds} />
        <ScheduleResourceFilter
          organizationId={organizationId}
          view={view}
          date={date}
          resources={allResources}
          selectedIds={selectedResourceIds}
        />
      </div>

      <ScheduleToolbar organizationId={organizationId} view={view} date={date} timezone={timezone} resourceIds={selectedResourceIds} />

      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        {view === 'week' ? (
          <WeekSchedule organizationId={organizationId} days={days} today={today} timezone={timezone} />
        ) : view === 'month' ? (
          <MonthSchedule
            organizationId={organizationId}
            days={days}
            monthDate={monthDate ?? date}
            today={today}
            resourceIds={selectedResourceIds}
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
            hasConfiguredHours={hasConfiguredHours}
            timezone={timezone}
            resourcesHref={resourcesHref}
            mayAddResource={mayAddResource}
          />
        )}
      </div>
    </div>
  );
}
