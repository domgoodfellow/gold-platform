import { cx } from '@/components/class-names';
import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { clipWindow } from '@/lib/domain/scheduling/window';
import { formatDayHeader } from './calendar-format';
import { ScheduleEvent } from './schedule-event';

/**
 * "What is scheduled across this week?" — seven persistent day surfaces, side by side on a wide
 * screen and stacked on a narrow one. Unlike Day, a column is one chronological agenda rather
 * than a Resource lane: seven columns of Resource lanes would be unreadable, so Week answers a
 * coarser question than Day does and says which Resource an entry belongs to instead of showing
 * it spatially. Every day renders its own cell whether or not anything is booked — the board is
 * never replaced by a sentence when the week is empty.
 */

function eventsFor(day: ScheduleDay) {
  return day.resources
    .flatMap((entry) =>
      entry.booked.map((booking) => ({
        ...booking,
        resourceName: entry.resource.name,
        // A booking that spans midnight is clipped to this column's own day — otherwise it
        // sorts and reads by the previous day's start time even on the day it only continues
        // into.
        displayWindow: clipWindow(booking.window, day.within) ?? booking.window,
      })),
    )
    .sort((a, b) => a.displayWindow.startsAt.localeCompare(b.displayWindow.startsAt));
}

export function WeekSchedule({
  organizationId,
  days,
  today,
  timezone,
}: {
  organizationId: string;
  days: ScheduleDay[];
  /** Today in the organization's own timezone — which cell gets the "today" treatment. */
  today: string;
  timezone: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-7 lg:gap-0 lg:divide-x lg:divide-border">
        {days.map((day) => {
          const events = eventsFor(day);
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              className={cx(
                'flex min-h-40 flex-col gap-2 border-b border-border p-2 last:border-b-0 lg:min-h-64 lg:border-b-0 lg:last:border-b-0',
                isToday && 'bg-hover/40',
              )}
            >
              <div className={cx('flex items-baseline justify-between text-sm font-medium', isToday && 'text-accent')}>
                <span>{formatDayHeader(day.date)}</span>
                {isToday ? <span className="text-xs font-normal uppercase tracking-wide text-accent">Today</span> : null}
              </div>
              {events.length === 0 ? (
                <p className="text-xs text-muted">Nothing scheduled.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 overflow-y-auto">
                  {events.map((event) => (
                    <li key={event.workItemId}>
                      <ScheduleEvent
                        organizationId={organizationId}
                        workItemId={event.workItemId}
                        title={event.title}
                        window={event.window}
                        displayWindow={event.displayWindow}
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
    </div>
  );
}
