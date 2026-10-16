import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput } from '@/components/controls/inputs';
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace';
import { calendarDates, parseCalendarView, parseCalendarDate } from '@/components/calendar/calendar-period';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import { OrganizationCalendar } from '@/features/calendar/organization-calendar';
import { loadOrganizationCalendar, parseCalendarSource } from '@/lib/application/calendar/organization-calendar';
import { todayInZone, shiftDate, startOfMonth, zonedDayRange } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';
import { workspaceAncestry } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { organizationId } = await params;
  const q = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const today = todayInZone(organization.timezone);
  const view = parseCalendarView(q.view);
  const date = parseCalendarDate(q.on, today);
  const source = parseCalendarSource(q.source);
  const dates = calendarDates(view, date);
  const data = await loadOrganizationCalendar(db, { organizationId, source, owner: q.owner, within: {
    startsAt: zonedDayRange(dates[0], organization.timezone).startsAt,
    endsAt: zonedDayRange(shiftDate(dates[dates.length - 1], 1), organization.timezone).startsAt,
  } });
  const base = `/organizations/${organizationId}`;
  const options = { organizationId, timezone: organization.timezone, members: data.members,
    mayManage: data.followUpsEnabled && organization.capabilities.includes('follow_up.manage') };
  const filters = { source, ...(q.owner ? { owner: q.owner } : {}) };
  return <AppPage className="flex h-full min-h-0 flex-1 flex-col">
    <CollectionHeader title="Calendar" crumbs={workspaceAncestry(organizationId, 'calendar')} actions={<>
      <ButtonLink href={`${base}/schedule`}>Work schedule</ButtonLink>
      {data.followUpsEnabled ? <ButtonLink href={`${base}/follow-ups`}>Follow-ups</ButtonLink> : null}
      {options.mayManage ? <FollowUpSheet {...options}/> : null}
    </>}/>
    <p className="mb-3 text-xs text-muted">{organization.timezone}</p>
    {data.notices.map(notice => <p key={notice} role="status" className="mb-3 text-sm text-muted">{notice}</p>)}
    <CalendarWorkspace basePath={`${base}/calendar`} view={view} date={date} today={today} filters={filters}
      filterControls={<form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view}/><input type="hidden" name="on" value={date}/>
        <SelectInput aria-label="Calendar source" name="source" defaultValue={source}>
          <option value="all">All sources</option><option value="follow-ups">CRM follow-ups</option><option value="work">Scheduled work</option>
        </SelectInput>
        {data.followUpsEnabled ? <SelectInput aria-label="Follow-up owner" name="owner" defaultValue={q.owner ?? ''}>
          <option value="">All follow-up owners</option><option value="unassigned">Unassigned follow-ups</option>
          {data.members.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}
        </SelectInput> : null}
        <Button type="submit">Apply</Button>
      </form>}>
      <OrganizationCalendar {...options} events={data.events} dates={dates} view={view} month={startOfMonth(date)} today={today} filters={filters}/>
    </CalendarWorkspace>
  </AppPage>;
}
