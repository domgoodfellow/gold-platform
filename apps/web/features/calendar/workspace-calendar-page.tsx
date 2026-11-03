import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace';
import { calendarDates, parseCalendarView, parseCalendarDate } from '@/components/calendar/calendar-period';
import { EventSheet } from './event-sheet';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { OrganizationCalendar } from '@/features/calendar/organization-calendar';
import { loadOrganizationCalendar } from '@/lib/application/calendar/organization-calendar';
import { todayInZone, shiftDate, startOfMonth, zonedDayRange, localDateTimeToInstant } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';
import { WORKSPACES, areaHref, type WorkspaceKey, workspaceAncestry } from '@/lib/navigation';
import { SelectField } from '@/components/controls/select-field';

export const dynamic = 'force-dynamic';

export async function WorkspaceCalendarPage({ params, searchParams, workspace }: {
  workspace: WorkspaceKey;
  params: Promise<{ organizationId: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { organizationId } = await params;
  const q = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const today = todayInZone(organization.timezone);
  const view = parseCalendarView(q.view);
  const date = parseCalendarDate(q.on, today);
  const scope = q.scope === 'workspace' ? 'workspace' : 'organization';
  const source = scope === 'organization' ? 'all' : workspace === 'crm' ? 'follow-ups' : workspace === 'field' ? 'work' : 'events';
  const actor = await requireActor(db);
  const dates = calendarDates(view, date);
  const data = await loadOrganizationCalendar(db, { organizationId, source, workspace: scope === 'workspace' ? workspace : undefined, within: {
    startsAt: zonedDayRange(dates[0], organization.timezone).startsAt,
    endsAt: zonedDayRange(shiftDate(dates[dates.length - 1], 1), organization.timezone).startsAt,
  } });
  const base = `/organizations/${organizationId}`;
  const calendarPath = `${areaHref(organizationId, WORKSPACES.find(item => item.key === workspace)!.home)}/calendar`;
  const options = { organizationId, timezone: organization.timezone, members: data.members,
    mayManage: workspace === 'crm' && data.followUpsEnabled && organization.capabilities.includes('follow_up.manage') };
  const filters = { scope };
  const newEventStart = localDateTimeToInstant(`${date}T09:00`, organization.timezone);
  return <AppPage className="flex h-full min-h-0 flex-1 flex-col">
    {/* CRM's calendar takes its location from the resolver (ADR-047); the other workspaces' calendars have not migrated yet. */}
    <CollectionHeader {...(workspace === 'crm' ? { location: {} } : { title: 'Calendar', crumbs: workspaceAncestry(organizationId, workspace === 'field' ? 'work-calendar' : `${workspace}-calendar`) })} actions={<>
      {workspace === 'field' ? <ButtonLink href={`${base}/schedule`}>Resource schedule</ButtonLink> : null}
      <EventSheet organizationId={organizationId} workspace={workspace} timezone={organization.timezone} startsAt={newEventStart}/>
    </>}/>
    <p className="mb-3 text-xs text-muted">{organization.timezone}</p>
    {data.notices.map(notice => <p key={notice} role="status" className="mb-3 text-sm text-muted">{notice}</p>)}
    <CalendarWorkspace basePath={calendarPath} view={view} date={date} today={today} filters={filters}
      filterControls={<form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view}/><input type="hidden" name="on" value={date}/>
        <SelectField aria-label="Calendar scope" name="scope" defaultValue={scope} options={[{ value: 'workspace', label: 'This view' }, { value: 'organization', label: 'This business' }]} />
        <Button type="submit">Apply</Button>
      </form>}>
      <OrganizationCalendar selectedDate={date} workspace={workspace} actorId={actor.id} mayManageCalendar={organization.capabilities.includes('organization.manage')} basePath={calendarPath} {...options} events={data.events} dates={dates} view={view} month={startOfMonth(date)} today={today} filters={filters}/>
    </CalendarWorkspace>
  </AppPage>;
}
