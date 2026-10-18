import { BusinessLabel } from '@/lib/context/business-vocabulary';
import { ViewNav } from '@/components/navigation/view-nav';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import { OperationalPanel } from '@/components/operational/primitives';
import { DispatchMap } from '@/features/work/dispatch-map';
import { AssignResourcesForm, ScheduleWorkItemForm } from '@/features/work/work-operations-forms';
import { listWorkItems, getWorkItem } from '@/lib/domain/work-items/work-items';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listResources } from '@/lib/domain/resources/resources';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResourceRequirements, requirementGroups, coverageView, evaluateRequirements } from '@/lib/domain/work-items/requirements';
import { RESOURCE_CLASS_LABELS, isResourceClass } from '@/lib/domain/resources/resource-class';
import { workOperations, scheduledIds } from '@/lib/application/work/operations';
import { todayInZone, formatWindow, zonedDayRange, shiftDate } from '@/lib/domain/scheduling/window';
import { parseScheduleDate } from '@/features/scheduling/calendar/schedule-url';
import { mapConfig } from '@/lib/adapters/maps/config';

import type { Db } from '@/lib/db/types';
import type { Organization } from '@/lib/domain/tenancy/organizations';

export async function DispatchWorkspace({ organizationId, query, db, organization }: { organizationId: string; query: Record<string, string | string[] | undefined>; db: Db; organization: Organization }) {
  const one = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const base = `/organizations/${organizationId}`;
  const date = parseScheduleDate(query.on, todayInZone(organization.timezone));
  const assignment = one('assignment');
  const mode = ['list', 'map'].includes(one('mode')) ? one('mode') : 'schedule';
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(one('page'))) || 1));
  const [data, types, resources, locations] = await Promise.all([
    workOperations(db, organizationId, date, organization.timezone), listWorkItemTypes(db, { organizationId }),
    listResources(db, { organizationId, limit: 1000 }), listLocations(db, { organizationId, limit: 1000 }),
  ]);
  const typeId = types.find(t => t.id === one('type'))?.id;
  const statuses = typeId ? await listWorkItemStatuses(db, { organizationId, typeId }) : [];
  const statusId = statuses.find(s => s.id === one('status'))?.id;
  const resourceId = resources.find(r => r.id === one('resource'))?.id;
  const resourceClass = isResourceClass(one('class')) ? one('class') : '';
  const shortfallIds = Object.entries(data.coverage).filter(([, c]) => !c.satisfied).map(([id]) => id);
  const conflictIds = [...new Set(data.day.resources.flatMap(r => r.booked.filter(b => b.availabilityProblem).map(b => b.workItemId)))];
  const classResourceIds = resourceClass ? resources.filter(r => r.resourceClass === resourceClass).map(r => r.id) : undefined;
  const filteredIds = assignment === 'shortfall' ? shortfallIds : assignment === 'conflict' ? conflictIds : assignment === 'scheduled' ? scheduledIds(data.day) : undefined;
  const queue = await listWorkItems(db, { organizationId, typeId, statusId, resourceId, resourceIds: classResourceIds, q: one('q'), active: true, limit: 20, offset: (page - 1) * 20,
    within: assignment === 'upcoming' ? { startsAt: zonedDayRange(date, organization.timezone).startsAt, endsAt: zonedDayRange(shiftDate(date, 7), organization.timezone).startsAt } : undefined,
    sort: assignment === 'upcoming' ? 'schedule' : 'newest',
    scheduled: assignment === 'unscheduled' ? false : assignment === 'unassigned' ? true : undefined,
    unassigned: assignment === 'unassigned', ids: filteredIds,
  });
  const selected = one('selected') ? await getWorkItem(db, { organizationId, workItemId: one('selected') }) : queue[0] ?? null;
  const requirements = selected ? await listResourceRequirements(db, { organizationId, typeId: selected.type.id }) : [];
  const needs = requirementGroups(requirements, resources, RESOURCE_CLASS_LABELS);
  const coverage = coverageView(evaluateRequirements(requirements, resources.filter(r => selected?.resources.some(x => x.id === r.id))), RESOURCE_CLASS_LABELS);
  const href = (patch: Record<string, string>) => { const p = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (typeof value === 'string') p.set(key, value); p.set('on', date); for (const [key, value] of Object.entries(patch)) { if (value) p.set(key, value); else p.delete(key); } return `${base}/work/dispatch?${p}`; };
  const maySchedule = organization.capabilities.includes('work_item.schedule');
  const boardItems = await listWorkItems(db, { organizationId, typeId, statusId, resourceId, resourceIds: classResourceIds, q: one('q'), ids: scheduledIds(data.day), limit: 1000 });
  const boardIds = new Set(boardItems.map(w => w.id));
  const lanes = data.day.resources.map(r => ({ ...r, booked: r.booked.filter(b => boardIds.has(b.workItemId)) })).filter(r => (!resourceId || r.resource.id === resourceId) && (!resourceClass || resources.find(x => x.id === r.resource.id)?.resourceClass === resourceClass));
  const markers = queue.flatMap(w => { const l = locations.find(l => l.id === w.location?.id); return l?.coordinates ? [{ id: w.id, label: `${w.title} · ${l.label}`, ...l.coordinates }] : []; });
  return <AppPage className="space-y-3">
    <PageHeader title="Dispatch board" crumbs={[{ label: 'Work', href: `${base}/field` }]} meta={`Times in ${organization.timezone} · availability is checked again when saving`} actions={<><ButtonLink size="small" tone="secondary" href={`${base}/schedule?on=${date}&view=day`}>Calendar</ButtonLink><ButtonLink size="small" tone="secondary" href={`${base}/work`}><BusinessLabel>Work items</BusinessLabel></ButtonLink></>}/>
    <form method="get" className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 md:grid-cols-4 xl:grid-cols-8">
      <label className="text-xs text-muted">Date<TextInput type="date" name="on" defaultValue={date}/></label>
      <label className="text-xs text-muted">Search<TextInput name="q" defaultValue={one('q')} placeholder="Work title"/></label>
      <label className="text-xs text-muted">Work type<SelectInput name="type" defaultValue={typeId ?? ''}><option value="">All types</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectInput></label>
      <label className="text-xs text-muted">Status<SelectInput name="status" defaultValue={statusId ?? ''}><option value="">All statuses</option>{statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></label>
      <label className="text-xs text-muted">Resource<SelectInput name="resource" defaultValue={resourceId ?? ''}><option value="">All resources</option>{resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></label>
      <label className="text-xs text-muted">Resource class<SelectInput name="class" defaultValue={resourceClass}><option value="">All classes</option>{Object.entries(RESOURCE_CLASS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</SelectInput></label>
      <label className="text-xs text-muted">Assignment state<SelectInput name="assignment" defaultValue={assignment}><option value="">All active work</option><option value="unassigned">Unassigned scheduled</option><option value="unscheduled">Unscheduled</option><option value="upcoming">Upcoming · 7 days</option><option value="scheduled">Scheduled · day</option><option value="shortfall">Requirement shortfalls · day</option><option value="conflict">Availability conflicts · day</option></SelectInput></label>
      <input type="hidden" name="mode" value={mode}/><div className="flex items-end"><Button size="small">Apply filters</Button></div>
    </form>
    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(190px,2fr)_minmax(0,5fr)] xl:grid-cols-[minmax(180px,2fr)_minmax(0,5fr)_minmax(250px,3fr)]">
      <OperationalPanel density="compact" flush title="Work queue" count={queue.total}>
        <p className="px-3 pb-2 text-[11px] text-muted">Unassigned / unscheduled span all dates. Other day filters use {date}.</p>
        <ul className="max-h-60 divide-y lg:max-h-[38rem] divide-border overflow-y-auto">{queue.map(w => <li key={w.id}><Link scroll={false} aria-current={selected?.id === w.id ? 'true' : undefined} href={href({ selected: w.id })} className={`block border-l-2 px-3 py-3 ${selected?.id === w.id ? 'border-accent bg-accent/5' : 'border-transparent hover:bg-surface'}`}><p className="text-sm font-medium">{w.title}</p><p className="mt-1 text-xs text-muted">{w.customer?.label ?? 'No customer'} · {w.status.label}</p><p className="mt-1 text-[11px] text-muted">{w.window ? formatWindow(w.window, organization.timezone) : 'Unscheduled'} · {w.resources.map(r => r.label).join(', ') || 'Unassigned'}</p>{data.coverage[w.id]?.shortfall ? <p className="mt-1 text-xs text-danger">{data.coverage[w.id].shortfall}</p> : null}</Link></li>)}</ul>
        {!queue.length ? <p className="p-4 text-sm text-muted">No work matches these filters.</p> : null}
        <div className="flex justify-between border-t border-border p-3 text-xs"><span>Page {page}</span>{page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : null}{page * 20 < queue.total ? <Link href={href({ page: String(page + 1) })}>Next</Link> : null}</div>
      </OperationalPanel>
      <OperationalPanel density="compact" flush className="order-2 lg:order-none" title="Assignment board" action={<ViewNav label="Dispatch mode" current={mode} className="mb-0" views={['list', 'schedule', 'map'].map(m => ({ key: m, href: href({ mode: m }), label: m[0].toUpperCase() + m.slice(1) }))} />}>
        {mode === 'map' ? <DispatchMap styleUrl={mapConfig()?.styleUrl ?? null} markers={markers} selectedId={selected?.id ?? null} selectionHref={href({ selected: '' })}/> : mode === 'list' ? <ul className="divide-y divide-border">{queue.map(w => <li key={w.id} className="flex items-center justify-between gap-3 px-3 py-3"><Link href={href({ selected: w.id })} scroll={false} className="text-sm font-medium">{w.title}</Link><span className="text-xs text-muted">{w.resources.map(r => r.label).join(', ') || 'Unassigned'}</span></li>)}</ul> : <div className="overflow-x-auto"><div className="min-w-[480px]"><p className="border-y border-border bg-surface/60 px-3 py-2 text-xs text-muted">{date} · resource commitments and free windows</p>{lanes.map(r => <div key={r.resource.id} className="grid grid-cols-[9rem_minmax(0,1fr)] border-b border-border text-xs"><div className="bg-surface/40 p-3"><Link className="font-medium" href={`${base}/resources/${r.resource.id}`}>{r.resource.name}</Link><div className="mt-1 text-muted">{r.exceptions.length ? `${r.exceptions.length} availability exception(s)` : 'No exceptions'}</div></div><div className="space-y-2 p-3">{r.booked.map(b => <Link key={b.workItemId} href={href({ selected: b.workItemId })} scroll={false} className={`block rounded-md border p-2 ${selected?.id === b.workItemId ? 'border-accent bg-accent/5' : 'border-border bg-surface/50'}`}><span className="font-medium">{b.title}</span><span className="ml-2 text-muted">{formatWindow(b.window, organization.timezone)}</span>{b.availabilityProblem ? <p className="text-danger">Outside resource availability</p> : null}</Link>)}{r.free.map((w, i) => <p key={i} className="text-[11px] text-muted">Free · {formatWindow(w, organization.timezone)}</p>)}{!r.free.length && !r.booked.length ? <p className="text-muted">No available windows</p> : null}</div></div>)}{!lanes.length ? <p className="p-4 text-sm text-muted">No resources match this view.</p> : null}<div className="p-3"><p className="mb-2 text-xs font-medium">Unassigned · {data.day.unassigned.filter(w => boardIds.has(w.workItemId)).length}</p>{data.day.unassigned.filter(w => boardIds.has(w.workItemId)).map(w => <Link key={w.workItemId} href={href({ selected: w.workItemId })} scroll={false} className="mb-2 block rounded-md border border-border p-2 text-xs">{w.title} · {formatWindow(w.window, organization.timezone)}</Link>)}</div></div></div>}
      </OperationalPanel>
      <div className="order-1 min-w-0 lg:order-none lg:col-span-2 xl:col-span-1"><OperationalPanel density="compact" flush title="Selected work">{selected ? <div key={`${selected.id}:${selected.window?.startsAt}:${selected.resources.map(r => r.id).join(',')}`} className="space-y-4 px-3 pb-4">
        <div><h3 className="font-semibold">{selected.title}</h3><p className="text-xs text-muted">{selected.type.label} · {selected.status.label}</p></div>
        <dl className="space-y-2 text-xs"><div><dt className="text-muted"><BusinessLabel>Customer</BusinessLabel></dt><dd>{selected.customer ? <Link href={`${base}/customers/${selected.customer.id}`}>{selected.customer.label}</Link> : 'No customer'}</dd></div><div><dt className="text-muted">Location</dt><dd>{selected.location ? <Link href={`${base}/locations/${selected.location.id}`}>{selected.location.label}</Link> : 'No location'}</dd></div><div><dt className="text-muted">Scheduled window</dt><dd>{selected.window ? formatWindow(selected.window, organization.timezone) : 'Unscheduled'}</dd></div><div><dt className="text-muted">Assigned resources</dt><dd>{selected.resources.map(r => r.label).join(', ') || 'Unassigned'}</dd></div></dl>
        <div className="rounded-md border border-border p-2 text-xs"><h4 className="mb-1 font-medium">Assignment coverage</h4>{coverage.lines.length ? coverage.lines.map(l => <p key={l.requirementId} className={l.met ? 'text-muted' : 'text-danger'}>{l.text}</p>) : <p className="text-muted">No resource requirements configured.</p>}</div>
        {maySchedule && selected.type.schedulable ? <><details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Assign / reassign</summary><div className="mt-3"><AssignResourcesForm organizationId={organizationId} workItemId={selected.id} resources={resources.map(r => ({ id: r.id, label: r.name }))} assigned={selected.resources.map(r => r.id)} needs={needs}/></div></details><details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Schedule / check feasibility</summary><div className="mt-3"><ScheduleWorkItemForm organizationId={organizationId} workItemId={selected.id} resources={resources.map(r => ({ id: r.id, label: r.name }))} assigned={selected.resources.map(r => r.id)} needs={needs} scheduled={!!selected.window} window={selected.window} timezone={organization.timezone}/></div></details></> : <p className="text-xs text-muted">{selected.type.schedulable ? 'Your role cannot assign or schedule work.' : 'This work type does not use scheduling.'}</p>}
        <ButtonLink size="small" tone="secondary" href={`${base}/work/${selected.id}`}>Open full work detail</ButtonLink>
      </div> : <p className="p-4 text-sm text-muted">Select a work item from the queue.</p>}</OperationalPanel></div>
    </div>
  </AppPage>;
}
