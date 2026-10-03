import Link from 'next/link';
import { cx } from '@/components/class-names';
import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { formatDayOfMonth } from './calendar-format';
import { scheduleHref } from './schedule-url';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PREVIEWS = 3;

/**
 * "Where is work landing this month?" — a coarser projection of the same Work Items Day and Week
 * read, never a second availability calculation and never a calendar entity: `days` is 42
 * contiguous tenant calendar dates (six full weeks, Monday first), supplied by `listScheduleDays`
 * exactly like Day and Week. A day outside the viewed month still renders — muted, never
 * dropped — so the grid is always six complete rows.
 */
export function MonthSchedule({
  organizationId,
  days,
  monthDate,
  today,
  resourceIds,
}: {
  organizationId: string;
  /** 42 contiguous tenant calendar days, Monday first, spanning the viewed month plus its lead/trail. */
  days: ScheduleDay[];
  /** The first of the viewed month — which cells belong to it, versus the adjacent muted ones. */
  monthDate: string;
  today: string;
  resourceIds: readonly string[];
}) {
  const monthPrefix = monthDate.slice(0, 7);
  const weeks: ScheduleDay[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-7 border-b border-border text-xs font-medium uppercase tracking-wide text-subtle">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1.5">
            {label}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-6 divide-y divide-border overflow-y-auto">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid min-h-28 grid-cols-7 divide-x divide-border">
            {week.map((day) => {
              const inMonth = day.date.startsWith(monthPrefix);
              const isToday = day.date === today;
              const events = day.resources.flatMap((entry) =>
                entry.booked.map((booking) => ({ ...booking, resourceName: entry.resource.name })),
              );
              const dayHref = scheduleHref(organizationId, { view: 'day', date: day.date, resourceIds });

              return (
                <Link
                  key={day.date}
                  href={dayHref}
                  className={cx(
                    'flex min-h-0 flex-col gap-1 p-1.5 hover:bg-hover',
                    !inMonth && 'bg-hover/30 text-subtle',
                  )}
                >
                  <span
                    className={cx(
                      'inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                      isToday && 'bg-accent text-on-accent font-medium',
                      !isToday && !inMonth && 'text-subtle',
                      !isToday && inMonth && 'font-medium',
                    )}
                  >
                    {formatDayOfMonth(day.date)}
                  </span>
                  <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                    {events.slice(0, MAX_PREVIEWS).map((event) => (
                      <span
                        key={event.workItemId}
                        className="truncate rounded bg-foreground/90 px-1 py-0.5 text-[11px] leading-tight text-background"
                      >
                        {event.title}
                      </span>
                    ))}
                    {events.length > MAX_PREVIEWS ? (
                      <span className="text-[11px] text-muted">+{events.length - MAX_PREVIEWS} more</span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
