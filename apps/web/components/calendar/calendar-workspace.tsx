import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/controls/button';
import { DatePicker } from '@/components/controls/date-picker';
import { ViewNav } from '@/components/navigation/view-nav';
import { shiftDate, shiftMonth } from '@/lib/domain/scheduling/window';
import { formatMonthLabel } from './calendar-format';

export type CalendarView = 'day' | 'week' | 'month';
export type CalendarFilters = Record<string, string | readonly string[]>;

export function calendarHref(basePath: string, view: CalendarView, date: string, filters: CalendarFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    for (const entry of typeof value === 'string' ? [value] : value) params.append(key, entry);
  }
  params.set('view', view);
  params.set('on', date);
  return `${basePath}?${params.toString()}`;
}

export function CalendarWorkspace({ basePath, view, date, today, filters = {}, filterControls, children }: {
  basePath: string;
  view: CalendarView;
  date: string;
  today: string;
  filters?: CalendarFilters;
  filterControls?: ReactNode;
  children: ReactNode;
}) {
  const href = (nextDate: string, nextView = view) => calendarHref(basePath, nextView, nextDate, filters);
  const shift = (direction: number) => view === 'month' ? shiftMonth(date, direction) : shiftDate(date, direction * (view === 'week' ? 7 : 1));
  const label = { day: 'Day', week: 'Week', month: 'Month' };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewNav label="Calendar views" className="mb-0" current={view} views={(['day', 'week', 'month'] as const).map(key => ({ key, label: label[key], href: href(date, key) }))} />
        {filterControls}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3" aria-label={`${label[view]} calendar controls`}>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={href(shift(-1))} size="small">← Previous</ButtonLink>
          <ButtonLink href={href(today)} size="small">Today</ButtonLink>
          <DatePicker value={date} basePath={basePath} param="on" label={`Show ${view === 'day' ? 'this day' : `the ${view} containing this day`}`} extraParams={{ ...filters, view }} />
          <ButtonLink href={href(shift(1))} size="small">Next →</ButtonLink>
          {view === 'month' ? <span className="ml-1 text-sm font-medium">{formatMonthLabel(date)}</span> : null}
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-border" aria-label={`${view} calendar`}>
        {children}
      </div>
    </div>
  );
}
