import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@gold/ui/components/tooltip';
import { ButtonLink } from '@/components/controls/button';
import { DatePicker } from '@/components/controls/date-picker';
import { ViewNav } from '@/components/navigation/view-nav';
import { shiftDate, shiftMonth } from '@/lib/domain/scheduling/window';
import { formatPeriodLabel } from './calendar-format';
import { calendarDates } from './calendar-period';

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

/**
 * A calendar's working surface: one control band, then the board, which fills the rest of the
 * page's height. The band holds everything that changes what the board shows, grouped by what it
 * does rather than given a row each: the period (step back, Today, step forward, and the period
 * itself, which opens a day picker), the timezone every time on the board is read in, then the view,
 * the caller's filters and the caller's actions — creating something on this calendar belongs here,
 * beside what it creates into. The groups wrap onto a second line when the working area is narrow.
 *
 * `notices` are only real conditions about what the board can show — a source that is unavailable
 * or restricted. An ordinary empty period is not a notice: the empty board says it.
 *
 * Every state is in the URL (`view`, `on`, and the caller's `filters`), so each control is a link or
 * a GET form and the page stays a plain server-rendered read.
 */
export function CalendarWorkspace({ basePath, view, date, today, timezone, filters = {}, filterControls, actions, notices, children }: {
  basePath: string;
  view: CalendarView;
  date: string;
  today: string;
  /** The timezone the board's times are in: the organization's own. */
  timezone?: string;
  filters?: CalendarFilters;
  filterControls?: ReactNode;
  /** Actions that create on this calendar, such as a new event. */
  actions?: ReactNode;
  notices?: ReactNode;
  children: ReactNode;
}) {
  const href = (nextDate: string, nextView = view) => calendarHref(basePath, nextView, nextDate, filters);
  const shift = (direction: number) => view === 'month' ? shiftMonth(date, direction) : shiftDate(date, direction * (view === 'week' ? 7 : 1));
  const label = { day: 'Day', week: 'Week', month: 'Month' };
  const period = formatPeriodLabel(view, calendarDates(view, date));
  const step = (direction: -1 | 1) => {
    const name = `${direction < 0 ? 'Previous' : 'Next'} ${view}`;
    return <Tooltip>
      <TooltipTrigger asChild>
        <ButtonLink href={href(shift(direction))} tone="secondary" aria-label={name} className="px-2">
          {direction < 0 ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}
        </ButtonLink>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div data-slot="calendar-toolbar" role="group" aria-label={`${label[view]} calendar controls`} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TooltipProvider>
            <div className="flex items-center gap-1">
              {step(-1)}
              <ButtonLink href={href(today)} tone="secondary">Today</ButtonLink>
              {step(1)}
            </div>
          </TooltipProvider>
          <DatePicker value={date} display={period} basePath={basePath} param="on" label={`Show ${view === 'day' ? 'this day' : `the ${view} containing this day`}`} extraParams={{ ...filters, view }} />
          {timezone ? <span className="text-xs text-muted"><span className="sr-only">Times are in </span>{timezone}</span> : null}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {/* Compact, so the switcher matches the band's other controls in height. */}
          <ViewNav label="Calendar views" size="small" className="p-0.5" current={view} views={(['day', 'week', 'month'] as const).map(key => ({ key, label: label[key], href: href(date, key) }))} />
          {filterControls}
          {actions}
        </div>
      </div>
      {notices}
      <div data-slot="calendar-board" className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border" aria-label={`${view} calendar`}>
        {children}
      </div>
    </div>
  );
}
