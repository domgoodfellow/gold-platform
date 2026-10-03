import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/controls/button';
import { DatePicker } from '@/components/controls/date-picker';
import { shiftDate, shiftMonth, todayInZone } from '@/lib/domain/scheduling/window';
import { formatMonthLabel } from './calendar-format';
import { scheduleHref, type ScheduleView } from './schedule-url';

const VIEW_LABEL: Record<ScheduleView, string> = { day: 'Day', week: 'Week', month: 'Month' };
const PICKER_LABEL: Record<ScheduleView, string> = {
  day: 'Show this day',
  week: 'Show the week containing this day',
  month: 'Show the month containing this day',
};

/**
 * Previous / Today / Next / a date picked rather than scrolled to — the whole of how a
 * dispatcher moves through time. Day shifts one tenant calendar day; Week shifts seven, so "Next"
 * always lands on the same weekday it left; Month shifts one calendar month, through `shiftMonth`
 * rather than a fixed day count, so "Next" from the 31st still lands in the following month. The
 * view and the resource filter travel with every one of these, through `scheduleHref` and
 * `DatePicker`'s own `extraParams`.
 */
export function ScheduleToolbar({
  organizationId,
  view,
  date,
  timezone,
  resourceIds,
}: {
  organizationId: string;
  view: ScheduleView;
  date: string;
  timezone: string;
  resourceIds: readonly string[];
}) {
  const hrefFor = (nextDate: string) => scheduleHref(organizationId, { view, date: nextDate, resourceIds });
  const today = todayInZone(timezone);
  const shift = (direction: 1 | -1): string => {
    if (view === 'week') return shiftDate(date, 7 * direction);
    if (view === 'month') return shiftMonth(date, direction);
    return shiftDate(date, direction);
  };

  const label: ReactNode = view === 'month' ? formatMonthLabel(date) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3" aria-label={VIEW_LABEL[view]}>
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={hrefFor(shift(-1))} size="small">
          ← Previous
        </ButtonLink>
        <ButtonLink href={hrefFor(today)} size="small">
          Today
        </ButtonLink>
        <DatePicker
          value={date}
          basePath={`/organizations/${organizationId}/schedule`}
          param="on"
          label={PICKER_LABEL[view]}
          extraParams={{ view, resource: resourceIds }}
        />
        <ButtonLink href={hrefFor(shift(1))} size="small">
          Next →
        </ButtonLink>
        {label ? <span className="ml-1 text-sm font-medium">{label}</span> : null}
      </div>
    </div>
  );
}
