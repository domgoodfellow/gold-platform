import { cx } from '@/components/class-names';
import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { formatDayHeader } from './calendar-format';
import { dayEvents } from './day-events';
import { ScheduleEvent } from './schedule-event';

/**
 * "What is scheduled across this week?" — seven persistent day surfaces, side by side on a wide
 * screen and stacked on a narrow one. Unlike Day, a column is one chronological agenda rather
 * than a Resource lane: seven columns of Resource lanes would be unreadable, so Week answers a
 * coarser question than Day does and says who is on an entry instead of showing it spatially — once,
 * however many resources take part, and "Unassigned" when nobody does. Every day renders its own cell whether or not anything is booked — the board is
 * never replaced by a sentence when the week is empty.
 */

export function WeekSchedule({
  organizationId,
  days,
  today,
  timezone,
  shortfalls,
}: {
  organizationId: string;
  days: ScheduleDay[];
  /** What each scheduled job is short of, by work item id. */
  shortfalls: Readonly<Record<string, string>>;
  /** Today in the organization's own timezone — which cell gets the "today" treatment. */
  today: string;
  timezone: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/*
        `md:`, not `lg:` — a seven-column week must read as a real calendar on anything desktop-
        or tablet-sized; only a genuinely phone-narrow viewport falls back to the stacked agenda.
        `md:auto-rows-fr` on a `md:flex-1` grid is what lets the single row of cells fill the
        canvas instead of sizing to its own (short) content and leaving the rest of the canvas
        blank — the same defect the fixed-pixel axis in Day avoids with `minHeight` + stretch.
      */}
      <div className="grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:auto-rows-fr md:grid-cols-7 md:gap-0 md:divide-x md:divide-border">
        {days.map((day) => {
          const events = dayEvents(day);
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              className={cx(
                'flex min-h-40 flex-col gap-2 border-b border-border p-2 last:border-b-0 md:min-h-0 md:border-b-0 md:last:border-b-0',
                isToday && 'bg-hover/40',
              )}
            >
              <div className={cx('flex shrink-0 items-baseline justify-between text-sm font-medium', isToday && 'text-accent')}>
                <span>{formatDayHeader(day.date)}</span>
                {isToday ? <span className="text-xs font-normal uppercase tracking-wide text-accent">Today</span> : null}
              </div>
              {events.length === 0 ? (
                <p className="text-xs text-muted">Nothing scheduled.</p>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                  {events.map((event) => (
                    <li key={event.workItemId}>
                      <ScheduleEvent
                        organizationId={organizationId}
                        workItemId={event.workItemId}
                        title={event.title}
                        window={event.window}
                        displayWindow={event.displayWindow}
                        resourceName={event.resourceNames.length > 0 ? event.resourceNames.join(' · ') : 'Unassigned'}
                        missing={shortfalls[event.workItemId]}
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
