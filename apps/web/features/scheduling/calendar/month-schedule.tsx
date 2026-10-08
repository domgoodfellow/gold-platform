import Link from 'next/link';
import { CalendarMonth } from '@/components/calendar/calendar-boards';
import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { dayEvents } from './day-events';
import { scheduleHref } from './schedule-url';

export function MonthSchedule({ organizationId, days, monthDate, today, resourceIds, shortfalls }: {
  organizationId: string;
  days: ScheduleDay[];
  monthDate: string;
  today: string;
  resourceIds: readonly string[];
  shortfalls: Readonly<Record<string, string>>;
}) {
  return <CalendarMonth monthDate={monthDate} today={today} days={days.map(day => {
    const href = scheduleHref(organizationId, { view: 'day', date: day.date, resourceIds });
    return { date: day.date, href, entries: dayEvents(day).map(event => ({
      id: event.workItemId,
      content: <Link href={href}>
        {shortfalls[event.workItemId] ? <><span aria-hidden>! </span><span className="sr-only">Not fully staffed: {shortfalls[event.workItemId]}. </span></> : null}
        {event.title}
      </Link>,
    })) };
  })} />;
}
