import { CalendarAgenda, CalendarMonth } from '@/components/calendar/calendar-boards';
import { calendarHref, type CalendarView } from '@/components/calendar/calendar-workspace';
import type { FollowUp } from '@/lib/domain/follow-ups/follow-ups';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { FollowUpSheet, type FollowUpOptions } from './follow-up-sheet';

export function FollowUpCalendar({ items, dates, view, month, today, owner, ...options }: FollowUpOptions & {
  items: FollowUp[];
  dates: string[];
  view: CalendarView;
  month: string;
  today: string;
  owner?: string;
}) {
  const time = new Intl.DateTimeFormat('en-CA', { timeZone: options.timezone, hour: 'numeric', minute: '2-digit' });
  const byDate = new Map<string, FollowUp[]>();
  for (const item of items) {
    const date = todayInZone(options.timezone, new Date(item.dueAt));
    const entries = byDate.get(date) ?? [];
    entries.push(item);
    byDate.set(date, entries);
  }
  if (view === 'month') return <CalendarMonth monthDate={month} today={today} days={dates.map(date => ({
    date,
    href: calendarHref(`/organizations/${options.organizationId}/follow-ups/calendar`, 'day', date, owner ? { owner } : {}),
    entries: (byDate.get(date) ?? []).map(item => ({ id: item.id, content: <FollowUpSheet {...options} item={item}>{item.title}</FollowUpSheet> })),
  }))} />;
  return <CalendarAgenda today={today} emptyLabel="No follow-ups due." days={dates.map(date => {
    const entries = byDate.get(date) ?? [];
    return { date, content: entries.length ? <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {entries.map(item => <li key={item.id} className={`rounded-md border-l-2 p-2 ${item.status === 'completed' ? 'border-success/30 bg-success/10' : item.status === 'cancelled' ? 'border-border bg-surface opacity-60' : 'border-foreground bg-surface'}`}>
        <p className="mb-1 text-xs capitalize text-muted">{time.format(new Date(item.dueAt))} · {item.kind} · {item.status}</p>
        <FollowUpSheet {...options} item={item}>{item.title}</FollowUpSheet>
        <p className="mt-1 text-xs text-muted">{item.customerName}</p>
        {item.opportunityTitle ? <p className="mt-1 text-xs text-muted">{item.opportunityTitle}</p> : null}
        <p className="mt-1 text-xs text-muted">{item.ownerName ?? 'Unassigned'}</p>
      </li>)}
    </ul> : null };
  })} />;
}
