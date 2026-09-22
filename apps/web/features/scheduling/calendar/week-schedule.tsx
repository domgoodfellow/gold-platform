import { EmptyState } from '@/components/containers/section';
import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { ScheduleEvent } from './schedule-event';

/**
 * "What is scheduled across this week?" — seven tenant calendar days, each its own chronological
 * agenda rather than a resource lane: seven columns of resource lanes would be unreadable, so
 * Week answers a coarser question than Day does and says which Resource an entry belongs to
 * instead of showing it spatially. Desktop lays the seven days side by side; anything narrower
 * collapses to one stacked agenda, day by day — `lg:grid-cols-7` is the one breakpoint doing that,
 * not a second component.
 */

function formatDayHeader(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function eventsFor(day: ScheduleDay) {
  return day.resources
    .flatMap((entry) => entry.booked.map((booking) => ({ ...booking, resourceName: entry.resource.name })))
    .sort((a, b) => a.window.startsAt.localeCompare(b.window.startsAt));
}

export function WeekSchedule({
  organizationId,
  days,
  timezone,
}: {
  organizationId: string;
  days: ScheduleDay[];
  timezone: string;
}) {
  const total = days.reduce((sum, day) => sum + day.resources.reduce((count, entry) => count + entry.booked.length, 0), 0);

  if (total === 0) {
    return <EmptyState className="mt-6">Nothing scheduled this week.</EmptyState>;
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-7 lg:gap-3">
      {days.map((day) => {
        const events = eventsFor(day);
        return (
          <div
            key={day.date}
            className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3 lg:last:border-r-0 lg:last:pr-0"
          >
            <div className="text-sm font-medium">{formatDayHeader(day.date)}</div>
            {events.length === 0 ? (
              <p className="text-xs text-muted">Nothing scheduled.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {events.map((event) => (
                  <li key={event.workItemId}>
                    <ScheduleEvent
                      organizationId={organizationId}
                      workItemId={event.workItemId}
                      title={event.title}
                      window={event.window}
                      resourceName={event.resourceName}
                      timezone={timezone}
                      variant="row"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
