import type { ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/components/class-names';
import { formatDayHeader, formatDayOfMonth } from './calendar-format';

export type CalendarDayContent = { date: string; content: ReactNode };

export function CalendarAgenda({ days, today, emptyLabel }: { days: CalendarDayContent[]; today: string; emptyLabel: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className={cx('grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:auto-rows-fr md:gap-0 md:divide-x md:divide-border', days.length === 7 && 'md:grid-cols-7')}>
        {days.map(day => (
          <section key={day.date} aria-label={day.date} className={cx('flex min-h-40 flex-col gap-2 border-b border-border p-2 last:border-b-0 md:min-h-0 md:border-b-0', day.date === today && 'bg-hover/40')}>
            <h2 className={cx('flex shrink-0 items-baseline justify-between text-sm font-medium', day.date === today && 'text-accent')}>
              <span>{formatDayHeader(day.date)}</span>
              {day.date === today ? <span className="text-xs font-normal uppercase tracking-wide text-accent">Today</span> : null}
            </h2>
            {day.content ?? <p className="text-xs text-muted">{emptyLabel}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

export function CalendarMonth({ days, monthDate, today }: {
  days: { date: string; href: string; entries: { id: string; content: ReactNode }[] }[];
  monthDate: string;
  today: string;
}) {
  const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-7 border-b border-border text-xs font-medium uppercase tracking-wide text-subtle">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => <div key={label} className="px-2 py-1.5">{label}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6 divide-y divide-border overflow-y-auto">
        {weeks.map((week, index) => (
          <div key={index} className="grid min-h-28 grid-cols-7 divide-x divide-border">
            {week.map(day => (
              <section key={day.date} aria-label={day.date} className={cx('flex min-w-0 min-h-0 flex-col gap-1 p-1.5', !day.date.startsWith(monthDate.slice(0, 7)) && 'bg-hover/30 text-subtle')}>
                <Link href={day.href} aria-label={`View ${day.date}`} className="hover:bg-hover">
                  <span className={cx('inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums', day.date === today ? 'bg-accent text-on-accent font-medium' : 'font-medium')}>{formatDayOfMonth(day.date)}</span>
                </Link>
                <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                  {day.entries.slice(0, 3).map(entry => <div key={entry.id} className="min-w-0 truncate rounded bg-foreground/90 px-1 py-0.5 text-[11px] leading-tight text-background [&_button]:block [&_button]:max-w-full [&_button]:truncate [&_button]:whitespace-nowrap [&_button]:text-inherit [&_button]:text-[11px] [&_button]:leading-tight">{entry.content}</div>)}
                  {day.entries.length > 3 ? <Link href={day.href} className="text-[11px] text-muted">+{day.entries.length - 3} more</Link> : null}
                </div>
              </section>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
