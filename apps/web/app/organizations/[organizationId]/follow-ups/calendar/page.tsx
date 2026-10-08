import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button,ButtonLink } from '@/components/controls/button';
import { TextInput,SelectInput } from '@/components/controls/inputs';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import { FollowUpCalendar } from '@/features/crm/follow-ups/follow-up-calendar';
import { listFollowUps } from '@/lib/domain/follow-ups/follow-ups';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';
import { todayInZone,shiftDate,shiftMonth,startOfMonth,isoDayOfWeek,zonedDayRange } from '@/lib/domain/scheduling/window';
import { parseScheduleView,parseScheduleDate } from '@/features/scheduling/calendar/schedule-url';
import { workspaceAncestry } from '@/lib/navigation';
export const dynamic='force-dynamic';
export default async function FollowUpCalendarPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {organizationId}=await params; const q=await searchParams; const {db,organization}=await requireOrganization(organizationId);
  if(!await followUpsAvailable(db,organizationId))notFound();
  const today=todayInZone(organization.timezone); const view=parseScheduleView(q.view); const on=parseScheduleDate(q.on,today);
  const validOn=Number.isFinite(Date.parse(`${on}T00:00:00Z`)) && new Date(`${on}T00:00:00Z`).toISOString().slice(0,10)===on?on:today;
  const month=startOfMonth(validOn); const first=view==='month'?shiftDate(month,1-isoDayOfWeek(month)):view==='week'?shiftDate(validOn,1-isoDayOfWeek(validOn)):validOn;
  const count=view==='month'?42:view==='week'?7:1; const end=shiftDate(first,count);
  const [items,members]=await Promise.all([listFollowUps(db,{organizationId,from:zonedDayRange(first,organization.timezone).startsAt,before:zonedDayRange(end,organization.timezone).startsAt,ownerMembershipId:q.owner==='unassigned'?null:q.owner||undefined,limit:500}),listMembers(db,{organizationId})]);
  const options={organizationId,timezone:organization.timezone,members,mayManage:organization.capabilities.includes('follow_up.manage')};
  const base=`/organizations/${organizationId}/follow-ups`; const href=(date:string,v=view)=>`${base}/calendar?${new URLSearchParams({on:date,view:v,...q.owner?{owner:q.owner}:{}})}`;
  const move=(direction:number)=>view==='month'?shiftMonth(validOn,direction):shiftDate(validOn,direction*count);
  return <AppPage><CollectionHeader title="Follow-ups calendar" crumbs={workspaceAncestry(organizationId,'follow-up-calendar')} actions={<><ButtonLink href={base}>Follow-ups</ButtonLink>{options.mayManage?<FollowUpSheet {...options}/>:null}</>}/>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ButtonLink href={href(move(-1))} aria-label="Previous period">←</ButtonLink><ButtonLink href={href(today)}>Today</ButtonLink><ButtonLink href={href(move(1))} aria-label="Next period">→</ButtonLink><span className="text-sm font-semibold">{validOn}</span></div>
      <div className="flex gap-1">{(['day','week','month'] as const).map(v=><ButtonLink key={v} href={href(validOn,v)} aria-current={view===v?'page':undefined}>{v}</ButtonLink>)}</div>
      <form method="get" className="flex flex-wrap gap-2"><input type="hidden" name="view" value={view}/><TextInput aria-label="Calendar date" type="date" name="on" defaultValue={validOn}/><SelectInput aria-label="Owner" name="owner" defaultValue={q.owner??''}><option value="">All owners</option><option value="unassigned">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</SelectInput><Button type="submit">Apply</Button></form>
    </div><p className="mb-3 text-xs text-muted">{organization.timezone} · {items.total} follow-ups{items.total>items.length?' · Calendar preview limited to 500; use owner filters or the collection for all records.':''}</p>
    <FollowUpCalendar {...options} items={items} dates={Array.from({length:count},(_,i)=>shiftDate(first,i))} view={view} month={month} today={today} owner={q.owner}/>
  </AppPage>;
}
