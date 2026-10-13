import Link from 'next/link';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { WorkCreateDrawer } from './work-create-drawer';
import { WorkTable } from './operations-panels';
import { MoveWorkItemForm } from './work-operations-forms';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { allowedNextStatusIds, type WorkItemTransition } from '@/lib/domain/work-items/transitions';
import type { Counted } from '@/lib/domain/counted';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import type { WorkItemType } from '@/lib/domain/work-items/types';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import type { CoverageView, ResourceNeedsView } from '@/lib/domain/work-items/requirements';
export function WorkList({ organizationId, role, timezone, types, selectedType, statuses, statusesByType, transitions, workItems, customers, locations, resources, assets, definitions, assetsEnabled, coverage, mayAdd, mayConfigure, mayMove, maySchedule, createOpen = false, view = 'list', page = 1, q = '', sort = 'newest', statusId = '', stages = {} }: {
  createOpen?: boolean;
  view?: 'list' | 'board'; page?: number; q?: string; sort?: string; statusId?: string; stages?: Record<string, Counted<WorkItem>>;
  organizationId: string;
  role: string;
  timezone: string;
  types: WorkItemType[];
  selectedType: WorkItemType | null;
  statuses: WorkItemStatus[];
  /** Stages for every type, so New work can switch type without showing another type's stages. */
  statusesByType: Record<string, WorkItemStatus[]>;
  transitions: WorkItemTransition[];
  workItems: Counted<WorkItem>;
  customers: { id: string; label: string }[];
  locations: { id: string; label: string }[];
  resources: { id: string; label: string }[];
  assets: { id: string; label: string }[];
  definitions: FieldDefinition[];
  assetsEnabled: boolean;
  /** What the selected kind of work needs, with who is eligible — null when it says nothing. */
  needs: ResourceNeedsView | null;
  /** Requirement coverage by work item id, for jobs of a type that needs something. */
  coverage: Record<string, CoverageView>;
  mayAdd: boolean;
  mayConfigure: boolean;
  mayMove: boolean;
  maySchedule: boolean;
}) {
  const base = `/organizations/${organizationId}`;
  const href = (patch: Record<string, string>) => { const p = new URLSearchParams({ type: selectedType?.id ?? '', view, q, sort, status: statusId }); for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); } return `${base}/work?${p}`; };
  const statusName = new Map(statuses.map(s => [s.id, s.name]));
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Work view" className="flex gap-1"><ButtonLink size="small" tone={view === 'list' ? 'primary' : 'secondary'} href={href({ view: 'list' })}>List</ButtonLink><ButtonLink size="small" tone={view === 'board' ? 'primary' : 'secondary'} href={href({ view: 'board', status: '' })}>Board</ButtonLink><ButtonLink size="small" tone="secondary" href={`${base}/work/dispatch`}>Dispatch board</ButtonLink></nav>
      {mayAdd && selectedType ? <WorkCreateDrawer key={selectedType.id} defaultOpen={createOpen} initialTypeId={selectedType.id} configureHref={mayConfigure ? `${base}/work/configuration` : undefined} options={{ organizationId, types, statusesByType, customers, locations, resources, assets, assetsEnabled, definitions }}/> : null}
    </div>
    <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
      <input type="hidden" name="view" value={view}/>
      <label className="text-xs text-muted">Work type<SelectInput name="type" defaultValue={selectedType?.id ?? ''}>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectInput></label>
      <label className="text-xs text-muted">Search<TextInput name="q" defaultValue={q} placeholder="Search work title"/></label>
      {view === 'list' ? <label className="text-xs text-muted">Status<SelectInput name="status" defaultValue={statusId}><option value="">All statuses</option>{statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></label> : null}
      <label className="text-xs text-muted">Sort<SelectInput name="sort" defaultValue={sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title</option><option value="schedule">Schedule</option></SelectInput></label><Button size="small">Apply filters</Button>
    </form>
    {!selectedType ? <div className="rounded-lg border border-border p-6"><h2 className="font-semibold">No work types yet</h2><p className="my-2 text-sm text-muted">Define the work this organization delivers, then add jobs.</p>{mayConfigure ? <ButtonLink href={`${base}/work/configuration`} size="small">Configure work</ButtonLink> : <p className="text-sm text-muted">Your role, {role}, cannot configure work types.</p>}</div> : view === 'list' ? <div className="overflow-hidden rounded-lg border border-border"><WorkTable organizationId={organizationId} timezone={timezone} rows={workItems} issues={Object.fromEntries(Object.entries(coverage).flatMap(([id, c]) => c.shortfall ? [[id, c.shortfall]] : []))}/><div className="flex justify-between border-t border-border p-3 text-xs"><span>{workItems.total} work items · Page {page}</span><nav aria-label="Work pagination" className="flex gap-4">{page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : null}{page * 20 < workItems.total ? <Link href={href({ page: String(page + 1) })}>Next</Link> : null}</nav></div></div> : <div className="overflow-x-auto pb-3"><div className="flex items-start gap-3">{statuses.map(status => { const rows = stages[status.id] ?? []; const total = stages[status.id]?.total ?? 0; return <section key={status.id} aria-label={status.name} className="w-72 shrink-0 rounded-lg border border-border bg-surface/40"><h2 className="flex justify-between border-b border-border p-3 text-sm font-semibold">{status.name}<span className="tabular-nums text-muted">{total}</span></h2><ul className="space-y-2 p-2">{rows.map(item => <li key={item.id} className="space-y-2 rounded-md border border-border bg-background p-3"><Link className="text-sm font-medium hover:underline" href={`${base}/work/${item.id}`}>{item.title}</Link><p className="text-xs text-muted">{item.customer?.label ?? 'No customer'}</p><p className="text-xs tabular-nums text-muted">{item.window ? formatWindow(item.window, timezone) : 'Unscheduled'}</p><div className="flex flex-wrap gap-1">{item.resources.map(r => <Badge key={r.id}>{r.label}</Badge>)}{!item.resources.length ? <span className="text-xs text-muted">Unassigned</span> : null}</div>{coverage[item.id]?.shortfall ? <p className="text-xs text-danger">{coverage[item.id].shortfall}</p> : null}<MoveWorkItemForm organizationId={organizationId} workItemId={item.id} moves={mayMove ? allowedNextStatusIds(transitions, item.status.id).flatMap(id => statusName.has(id) ? [{ id, name: statusName.get(id)! }] : []) : []}/>{maySchedule && item.type.schedulable ? <Link href={`${base}/work/dispatch?selected=${item.id}`} className="block text-xs text-accent">Assign / schedule</Link> : null}</li>)}</ul>{!rows.length ? <p className="px-3 pb-5 text-xs text-muted">No work in this stage.</p> : null}{total > rows.length ? <Link className="block px-3 pb-3 text-xs text-accent" href={href({ view: 'list', status: status.id })}>View all {total} in {status.name}</Link> : null}</section>; })}</div></div>}
  </div>;
}
