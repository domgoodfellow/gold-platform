import { BusinessLabel } from '@/lib/context/business-vocabulary';
import { ViewNav } from '@/components/navigation/view-nav';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { OperationalPanel } from '@/components/operational/primitives';
import { DispatchMap } from '@/features/work/dispatch-map';
import { DispatchOperationDialog, DispatchSelectionNotice } from './dispatch-operation-dialog';
import { CollectionToolbar, type ActiveFilter } from '@/components/patterns/collection-toolbar';
import { WorkTypeSelect } from './work-type-select';
import { dispatchHref, DISPATCH_ASSIGNMENTS } from './dispatch-url';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listResources } from '@/lib/domain/resources/resources';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResourceRequirements, requirementGroups, coverageView, evaluateRequirements, evaluateWorkItems } from '@/lib/domain/work-items/requirements';
import { RESOURCE_CLASS_LABELS, isResourceClass } from '@/lib/domain/resources/resource-class';
import { workOperations, scheduledIds } from '@/lib/application/work/operations';
import { todayInZone, formatWindow, upcomingWindow } from '@/lib/domain/scheduling/window';
import { scheduleHref, parseScheduleDate } from '@/features/scheduling/calendar/schedule-url';
import { mapConfig } from '@/lib/adapters/maps/config';

import type { Db } from '@/lib/db/types';
import type { Organization } from '@/lib/domain/tenancy/organizations';
import { SelectField } from '@/components/controls/select-field';

export async function DispatchWorkspace({ organizationId, query, db, organization }: { organizationId: string; query: Record<string, string | string[] | undefined>; db: Db; organization: Organization }) {
  const one = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const base = `/organizations/${organizationId}`;
  const date = parseScheduleDate(query.on, todayInZone(organization.timezone));
  const assignment = DISPATCH_ASSIGNMENTS.find(([key]) => key === one('assignment'))?.[0] ?? '';
  const mode = ['schedule', 'map'].includes(one('mode')) ? one('mode') : 'list';
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
  const criteria = { organizationId, typeId, statusId, resourceId, resourceIds: classResourceIds, q: one('q'), active: true,
    within: assignment === 'upcoming' ? upcomingWindow(date, organization.timezone) : undefined,
    sort: assignment === 'upcoming' ? 'schedule' as const : 'newest' as const,
    scheduled: assignment === 'unscheduled' ? false : assignment === 'unassigned' ? true : undefined,
    unassigned: assignment === 'unassigned', ids: filteredIds,
  };
  let queue = await listWorkItems(db, { ...criteria, limit: 20, offset: (page - 1) * 20 });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(queue.total / 20)));
  if (currentPage !== page) queue = await listWorkItems(db, { ...criteria, limit: 20, offset: (currentPage - 1) * 20 });
  // A deep link may point beyond this page, but must still match the complete database filter and RLS.
  const selectedId = one('selected');
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedId);
  const selected = selectedId ? validId && (!filteredIds || filteredIds.includes(selectedId))
    ? (await listWorkItems(db, { ...criteria, ids: [selectedId], limit: 1 }))[0] ?? null : null : queue[0] ?? null;
  const queueEvaluations = await evaluateWorkItems(db, { organizationId, items: queue.map(w => ({ workItemId: w.id, typeId: w.type.id, resourceIds: w.resources.map(r => r.id) })) });
  const queueCoverage = Object.fromEntries([...queueEvaluations].map(([id, value]) => [id, coverageView(value, RESOURCE_CLASS_LABELS)]));
  const requirements = selected ? await listResourceRequirements(db, { organizationId, typeId: selected.type.id }) : [];
  const needs = requirementGroups(requirements, resources, RESOURCE_CLASS_LABELS);
  const coverage = coverageView(evaluateRequirements(requirements, resources.filter(r => selected?.resources.some(x => x.id === r.id))), RESOURCE_CLASS_LABELS);
  const state = { on: date, q: one('q'), type: typeId ?? '', status: statusId ?? '', resource: resourceId ?? '', class: resourceClass, assignment, mode, page: String(currentPage), selected: selected?.id ?? '' };
  const href = (patch: Record<string, string>) => dispatchHref(organizationId, state, patch);
  const calendar = (id = resourceId) => scheduleHref(organizationId, { view: 'day', date, resourceIds: id ? [id] : [] });
  const maySchedule = organization.capabilities.includes('work_item.schedule');
  const lanes = data.day.resources.filter(r => (!resourceId || r.resource.id === resourceId) && (!resourceClass || resources.find(x => x.id === r.resource.id)?.resourceClass === resourceClass));
  const labels: Record<string, string> = { q: `Search: ${one('q')}`, type: `Type: ${types.find(t => t.id === typeId)?.name}`, status: `Status: ${statuses.find(s => s.id === statusId)?.name}`, resource: `Resource: ${resources.find(r => r.id === resourceId)?.name}`, class: `Class: ${isResourceClass(resourceClass) ? RESOURCE_CLASS_LABELS[resourceClass] : ''}`, assignment: DISPATCH_ASSIGNMENTS.find(([key]) => key === assignment)?.[1] ?? '' };
  const active: ActiveFilter[] = Object.entries(labels).filter(([key]) => state[key as keyof typeof state]).map(([key, label]) => ({ key, label, removeHref: href({ [key]: '' }) }));
  const markers = queue.flatMap(w => { const l = locations.find(l => l.id === w.location?.id); return l?.coordinates ? [{ id: w.id, label: `${w.title} · ${l.label}`, ...l.coordinates }] : []; });
  return <AppPage className="space-y-3">
    <PageHeader title="Dispatch" crumbs={[{ label: 'Work', href: `${base}/field` }]} actions={<><ButtonLink size="small" tone="secondary" href={calendar()}>Schedule</ButtonLink><ButtonLink size="small" tone="secondary" href={`${base}/work`}><BusinessLabel>Work items</BusinessLabel></ButtonLink></>}/>
    <CollectionToolbar action={`${base}/work/dispatch`} viewId="dispatch"
      leading={<div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="dispatch-date">Date</label><TextInput id="dispatch-date" name="on" type="date" defaultValue={date} title={organization.timezone} className="w-full sm:w-40"/><WorkTypeSelect value={typeId ?? ''} types={[{ id: '', name: 'All work types' }, ...types]} hrefs={Object.fromEntries([{ id: '' }, ...types].map(t => [t.id, href({ type: t.id })]))}/></div>}
      search={{ name: 'q', value: one('q'), label: 'Search work', placeholder: 'Search work titles' }}
      hidden={{ mode }}
      filterCount={[statusId, resourceId, resourceClass, assignment].filter(Boolean).length}
      filters={<>
        <label className="text-sm">Status<SelectField name="status" defaultValue={statusId ?? ''} options={[{ value: '', label: 'All statuses' }, ...statuses.map((s) => ({ value: s.id, label: s.name }))]} /></label>
        <label className="text-sm">Resource<SelectField name="resource" defaultValue={resourceId ?? ''} options={[{ value: '', label: 'All resources' }, ...resources.map((r) => ({ value: r.id, label: r.name }))]} /></label>
        <label className="text-sm">Resource class<SelectField name="class" defaultValue={resourceClass} options={[{ value: '', label: 'All classes' }, ...Object.entries(RESOURCE_CLASS_LABELS).map(([id, label]) => ({ value: id, label: label }))]} /></label>
        <label className="text-sm">Assignment state<SelectField name="assignment" defaultValue={assignment} options={[...DISPATCH_ASSIGNMENTS.map(([key, label]) => ({ value: key, label: label }))]} /></label>
      </>}
      display={<ViewNav label="Dispatch presentation" size="small" className="mb-0" items={[['list', 'Queue'], ['schedule', 'Availability'], ['map', 'Map']].map(([key, label]) => ({ key, label, href: href({ mode: key }), current: mode === key }))}/>}
      active={active} resetHref={active.length ? dispatchHref(organizationId, { on: date, mode }) : undefined}/>
    <p className="text-xs text-muted">{assignment === 'upcoming' ? 'Seven local dates after the selected day.' : ['scheduled', 'shortfall', 'conflict'].includes(assignment) ? `Selected day: ${date}.` : 'Active work across all dates.'} Select work to resolve assignment and scheduling exceptions.</p>
    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
      <OperationalPanel density="compact" body="edge-to-edge" title="Work queue" count={queue.total}>
        <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto lg:max-h-[42rem]">{queue.map(w => <li key={w.id}><Link scroll={false} aria-current={selected?.id === w.id ? 'true' : undefined} href={href({ selected: w.id })} className={`block break-words border-l-2 px-3 py-3 ${selected?.id === w.id ? 'border-accent bg-accent/5' : 'border-transparent hover:bg-surface'}`}><p className="text-sm font-medium">{w.title}</p><p className="mt-1 text-xs text-muted">{w.customer?.label ?? 'No customer'} · {w.status.label}</p><p className="mt-1 text-[11px] text-muted">{w.window ? formatWindow(w.window, organization.timezone) : 'Unscheduled'} · {w.resources.map(r => r.label).join(', ') || 'Unassigned'}</p>{queueCoverage[w.id]?.shortfall ? <p className="mt-1 text-xs text-danger">{w.window ? 'Required resources missing' : 'Not yet staffed'} - {queueCoverage[w.id].shortfall}</p> : null}{conflictIds.includes(w.id) ? <p className="mt-1 text-xs text-danger">Outside resource availability - selected day</p> : null}</Link></li>)}</ul>
        {!queue.length ? <p className="p-4 text-sm text-muted">No work matches these filters.</p> : null}
        <div className="flex justify-between border-t border-border p-3 text-xs"><span>Page {currentPage} of {Math.max(1, Math.ceil(queue.total / 20))}</span>{currentPage > 1 ? <Link href={href({ page: String(currentPage - 1) })}>Previous</Link> : null}{currentPage * 20 < queue.total ? <Link href={href({ page: String(currentPage + 1) })}>Next</Link> : null}</div>
      </OperationalPanel>
      <div className={`min-w-0 space-y-3 ${selectedId ? 'order-first lg:order-none' : ''}`}><OperationalPanel density="compact" title="Selected work">{selected ? <div key={selected.id} className="space-y-4">
        <div><h3 className="font-semibold">{selected.title}</h3>{!queue.some(w => w.id === selected.id) ? <p className="mt-1 text-xs text-muted">Selected work is on another queue page.</p> : null}<p className="text-xs text-muted">{selected.type.label} · {selected.status.label}</p></div>
        <dl className="space-y-2 text-xs"><div><dt className="text-muted"><BusinessLabel>Customer</BusinessLabel></dt><dd>{selected.customer ? <Link href={`${base}/crm/contacts/${selected.customer.id}`}>{selected.customer.label}</Link> : 'No customer'}</dd></div><div><dt className="text-muted">Location</dt><dd>{selected.location ? <Link href={`${base}/locations/${selected.location.id}`}>{selected.location.label}</Link> : 'No location'}</dd></div><div><dt className="text-muted">Scheduled window</dt><dd>{selected.window ? formatWindow(selected.window, organization.timezone) : 'Unscheduled'}</dd></div><div><dt className="text-muted">Assigned resources</dt><dd>{selected.resources.map(r => r.label).join(', ') || 'Unassigned'}</dd></div></dl>
        <div className="rounded-md border border-border p-2 text-xs"><h4 className="mb-1 font-medium">Required resources</h4>{!selected.window && !coverage.satisfied ? <p className="mb-1 font-medium">Not yet staffed</p> : null}{coverage.lines.length ? coverage.lines.map(l => <p key={l.requirementId} className={l.met ? 'text-muted' : 'text-danger'}>{l.text}</p>) : <p className="text-muted">No resource requirements configured.</p>}</div>
        <div className="text-xs"><h4 className="font-medium">Availability</h4><p className="mt-1 text-muted">{!selected.window ? 'Choose a time to check resource availability.' : !selected.resources.length ? 'No assigned resources to assess. Assign resources to check availability.' : !scheduledIds(data.day).includes(selected.id) ? 'Open Schedule for this work date, or check its time when rescheduling.' : conflictIds.includes(selected.id) ? 'Outside resource availability on the selected day. Reassign resources or reschedule.' : 'No resource availability conflicts reported on the selected day. Saving rechecks availability.'}</p></div>
        {maySchedule && selected.type.schedulable ? <div className="flex flex-wrap gap-2">{(['assign', 'schedule'] as const).map(operation => <DispatchOperationDialog key={operation} operation={operation} organizationId={organizationId} workItemId={selected.id} resources={resources.map(r => ({ id: r.id, label: r.name }))} assigned={selected.resources.map(r => r.id)} needs={needs} scheduled={!!selected.window} window={selected.window} timezone={organization.timezone}/>)}</div> : <p className="text-xs text-muted">{selected.type.schedulable ? 'Your role cannot assign or schedule work.' : 'This work type does not use scheduling.'}</p>}
        <div className="flex flex-wrap gap-2"><ButtonLink size="small" tone="secondary" href={`${base}/work/${selected.id}`}>Open Work record</ButtonLink>{selected.window ? <ButtonLink size="small" tone="secondary" href={scheduleHref(organizationId, { view: 'day', date: todayInZone(organization.timezone, new Date(selected.window.startsAt)), resourceIds: selected.resources.map(r => r.id) })}>View in Schedule</ButtonLink> : null}</div>
      </div> : selectedId ? <DispatchSelectionNotice key={selectedId}/> : <p className="text-sm text-muted">Select a work item from the queue.</p>}</OperationalPanel>
        {mode === 'map' ? <OperationalPanel density="compact" body="edge-to-edge" title="Map"><DispatchMap styleUrl={mapConfig()?.styleUrl ?? null} markers={markers} selectedId={selected?.id ?? null} selectionHref={href({ selected: '' })}/></OperationalPanel> : null}
        {mode === 'schedule' ? <OperationalPanel density="compact" title="Resource availability" action={<ButtonLink size="small" tone="secondary" href={calendar()}>Open Schedule</ButtonLink>}>
          <p className="mb-3 text-xs text-muted">{date} - <span title="Organization timezone">{organization.timezone}</span>. Commitments and free windows from Schedule.</p>
          <ul className="space-y-3">{lanes.map(lane => <li key={lane.resource.id} className="border-t border-border pt-2 text-xs">
            <Link className="font-medium underline" href={calendar(lane.resource.id)}>{lane.resource.name} - {lane.booked.length} commitments</Link>
            {lane.exceptions.length ? <p className="mt-1 text-muted">{lane.exceptions.length} availability exceptions</p> : null}
            {lane.free.map((window, i) => <p key={i} className="mt-1 text-muted">Free - {formatWindow(window, organization.timezone)}</p>)}
            {!lane.free.length ? <p className="mt-1 text-muted">No free windows</p> : null}
          </li>)}</ul>{!lanes.length ? <p className="text-sm text-muted">No resources match this view.</p> : null}
        </OperationalPanel> : null}
      </div>
    </div>
  </AppPage>;
}
