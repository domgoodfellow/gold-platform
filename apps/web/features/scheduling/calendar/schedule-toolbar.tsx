import { ButtonLink } from '@/components/controls/button';
import { DatePicker } from '@/components/controls/date-picker';
import { Toolbar } from '@/components/display/data';
import { shiftDate, todayInZone } from '@/lib/domain/scheduling/window';
import { scheduleHref, type ScheduleView } from './schedule-url';

/**
 * Previous / Today / Next / a date picked rather than scrolled to — the whole of how a
 * dispatcher moves through time. Day shifts one tenant calendar day; Week shifts seven, so
 * "Next" always lands on the same weekday it left. The view and the resource filter travel with
 * every one of these, through `scheduleHref` and `DatePicker`'s own `extraParams`.
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
  const step = view === 'week' ? 7 : 1;
  const hrefFor = (nextDate: string) => scheduleHref(organizationId, { view, date: nextDate, resourceIds });
  const today = todayInZone(timezone);

  return (
    <Toolbar aria-label={view === 'week' ? 'Week' : 'Day'}>
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={hrefFor(shiftDate(date, -step))} size="small">
          ← Previous
        </ButtonLink>
        <ButtonLink href={hrefFor(today)} size="small">
          Today
        </ButtonLink>
        <DatePicker
          value={date}
          basePath={`/organizations/${organizationId}/schedule`}
          param="on"
          label={view === 'week' ? 'Show the week containing this day' : 'Show this day'}
          extraParams={{ view, resource: resourceIds }}
        />
        <ButtonLink href={hrefFor(shiftDate(date, step))} size="small">
          Next →
        </ButtonLink>
      </div>
    </Toolbar>
  );
}
