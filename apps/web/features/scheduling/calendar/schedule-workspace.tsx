import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { DaySchedule } from './day-schedule';
import { WeekSchedule } from './week-schedule';
import { ScheduleResourceFilter } from './schedule-resource-filter';
import { ScheduleToolbar } from './schedule-toolbar';
import { ScheduleViewNav } from './schedule-view-nav';
import type { ScheduleView } from './schedule-url';

/**
 * The Schedule workspace: view navigation and the resource filter share a row, the toolbar sits
 * beneath it, and the Day or Week body fills the rest. The route loads the data and resolves the
 * URL into `view`/`date`/`selectedResourceIds`; everything below this line is what Schedule
 * actually looks like.
 */
export function ScheduleWorkspace({
  organizationId,
  view,
  date,
  timezone,
  days,
  allResources,
  selectedResourceIds,
  hasConfiguredHours,
}: {
  organizationId: string;
  view: ScheduleView;
  date: string;
  timezone: string;
  /** Already filtered to `selectedResourceIds` — one entry for Day, seven for Week. */
  days: ScheduleDay[];
  /** Every Resource this organization has, unfiltered — what the filter itself offers to choose from. */
  allResources: { id: string; name: string }[];
  selectedResourceIds: readonly string[];
  hasConfiguredHours: boolean;
}) {
  const today = days[0];

  return (
    <div className="mt-4">
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

      {view === 'week' ? (
        <WeekSchedule organizationId={organizationId} days={days} timezone={timezone} />
      ) : (
        <DaySchedule
          organizationId={organizationId}
          within={today.within}
          open={today.open}
          resources={today.resources}
          hasConfiguredHours={hasConfiguredHours}
          timezone={timezone}
        />
      )}
    </div>
  );
}
