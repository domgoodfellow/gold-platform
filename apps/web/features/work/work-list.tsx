import Link from 'next/link';
import { Route } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { SelectInput } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable, type Column } from '@/components/display/table';
import { ViewNav } from '@/components/navigation/view-nav';
import { Board, BoardCard, BoardColumn } from '@/components/patterns/board';
import { CollectionHeader } from '@/components/patterns/collection-header';
import type { PageLocationCrumb } from '@/components/navigation/page-location';
import { CollectionToolbar, type ActiveFilter } from '@/components/patterns/collection-toolbar';
import { NewWorkAction } from './new-work-action';
import { MoveWorkItemForm } from './work-operations-forms';
import { WorkTypeSelect } from './work-type-select';
import { WORK_PAGE_SIZE, WORK_SORTS, workDirectoryHref, type WorkDirectoryView } from './work-directory';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { allowedNextStatusIds, type WorkItemTransition } from '@/lib/domain/work-items/transitions';
import type { Counted } from '@/lib/domain/counted';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import type { WorkItemType } from '@/lib/domain/work-items/types';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import type { CoverageView } from '@/lib/domain/work-items/requirements';

/**
 * Work items: one Work type at a time, as a List or a Board of its stages. The shared collection
 * toolbar holds the type, search, status (List only), sort and the List / Board choice, all in the
 * address, so the database filters, counts and pages. Dispatch is its own assignment workflow, a
 * header action beside New work, never a third presentation. Schedule and resource columns appear
 * only for a type that is scheduled; the Board offers only the moves the type's transitions allow.
 */
export function WorkList({ title, crumbs, organizationId, timezone, types, selectedType, statuses, transitions, workItems, coverage, view, stages = {}, mayAdd, mayConfigure, mayMove, maySchedule, activity, insights, configure }: {
  /** The business's own name for Work items, and its trail. */
  title: string; crumbs: PageLocationCrumb[];
  organizationId: string;
  timezone: string;
  types: WorkItemType[];
  selectedType: WorkItemType | null;
  statuses: WorkItemStatus[];
  transitions: WorkItemTransition[];
  workItems: Counted<WorkItem>;
  /** Requirement coverage by work item id, for jobs of a type that needs something. */
  coverage: Record<string, CoverageView>;
  view: WorkDirectoryView;
  stages?: Record<string, Counted<WorkItem>>;
  mayAdd: boolean; mayConfigure: boolean; mayMove: boolean; maySchedule: boolean;
  activity: boolean; insights: boolean; configure: boolean;
}) {
  const base = `/organizations/${organizationId}`;
  const href = (changes: Partial<WorkDirectoryView>) => workDirectoryHref(organizationId, view, changes);
  const ready = statuses.length > 0;
  const scheduled = Boolean(selectedType?.schedulable);
  const statusName = new Map(statuses.map(s => [s.id, s.name]));
  const shortfall = (id: string) => coverage[id]?.shortfall ?? null;
  const header = <CollectionHeader title={title} crumbs={crumbs} activity={activity} insights={insights} configure={configure} actions={<>
    {scheduled ? <ButtonLink tone="secondary" size="small" href={`${base}/work/dispatch`}><Route aria-hidden className="size-4" /><span className="max-sm:sr-only">Dispatch</span></ButtonLink> : null}
    {mayAdd && ready ? <NewWorkAction organizationId={organizationId} typeId={selectedType?.id} /> : null}
  </>} />;

  if (!selectedType || !ready) return <>
    {header}
    <section aria-labelledby="work-setup" data-slot="compact-empty" className="flex flex-col gap-3 rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><h2 id="work-setup" className="text-base font-semibold">{selectedType ? `${selectedType.name} has no starting stage` : 'No work types yet'}</h2>
        <p className="mt-1 text-sm text-muted">{selectedType ? 'Work of this type can be created once it has a first stage.' : 'Work types name the jobs this business does and the stages each one moves through.'}</p></div>
      {mayConfigure ? <ButtonLink tone="primary" size="small" href={`${base}/work/configuration${selectedType ? `?type=${selectedType.id}` : ''}`}>{selectedType ? 'Add a starting stage' : 'Set up work types'}</ButtonLink> : <p className="text-sm text-muted">Someone who manages Work sets this up.</p>}
    </section>
    {selectedType && types.length > 1 ? <nav aria-label="Other work types" className="mt-3 flex flex-wrap gap-2 text-sm">{types.filter(type => type.id !== selectedType.id).map(type => <Link key={type.id} className="text-accent-text underline underline-offset-4" href={href({ type: type.id })}>{type.name}</Link>)}</nav> : null}
  </>;

  const filtered = Boolean(view.q || view.status);
  const active: ActiveFilter[] = [
    ...(view.q ? [{ key: 'q', label: `Search: ${view.q}`, removeHref: href({ q: '' }) }] : []),
    ...(view.status && statusName.has(view.status) ? [{ key: 'status', label: `Status: ${statusName.get(view.status)}`, removeHref: href({ status: undefined }) }] : []),
  ];
  const total = view.view === 'board' ? statuses.reduce((sum, status) => sum + (stages[status.id]?.total ?? 0), 0) : workItems.total;
  const pages = Math.max(1, Math.ceil(workItems.total / WORK_PAGE_SIZE));
  const typeName = selectedType.name;
  const firstRun = total === 0 && !filtered;

  const columns: Column<WorkItem>[] = [
    { key: 'work', header: 'Work', emphasis: 'primary', cell: w => <span className="flex min-w-0 flex-col"><Link className="font-medium hover:underline" href={`${base}/work/${w.id}`}>{w.title}</Link>{w.location ? <span className="text-xs font-normal text-muted">{w.location.label}</span> : null}</span> },
    { key: 'contact', header: 'Contact', cell: w => w.customer ? <Link className="hover:underline" href={`${base}/crm/contacts/${w.customer.id}`}>{w.customer.label}</Link> : <span className="text-muted">—</span>, cardValue: w => w.customer ? <Link className="hover:underline" href={`${base}/crm/contacts/${w.customer.id}`}>{w.customer.label}</Link> : null },
    ...(scheduled ? [
      { key: 'schedule', header: 'Scheduled', cell: (w: WorkItem) => <span className="whitespace-nowrap tabular-nums text-muted">{w.window ? formatWindow(w.window, timezone) : 'Unscheduled'}</span> },
      { key: 'resources', header: 'Resources', cell: (w: WorkItem) => w.resources.length ? w.resources.map(r => r.label).join(', ') : <span className="text-muted">Unassigned</span> },
    ] : []),
    { key: 'status', header: 'Status', cell: w => <span className="flex flex-col items-start gap-1"><Badge>{w.status.label}</Badge>{shortfall(w.id) ? <span className="text-xs text-danger">{shortfall(w.id)}</span> : null}</span> },
  ];
  // The one contextual action: placing work that is not yet scheduled or not yet staffed. Opening a record is its title.
  const placement = (w: WorkItem) => maySchedule && w.type.schedulable && (!w.window || !w.resources.length)
    ? <ButtonLink tone="text" size="small" href={`${base}/work/dispatch?selected=${w.id}`}>{w.window ? 'Assign' : 'Schedule'}</ButtonLink> : null;

  return <>
    {header}
    <CollectionToolbar action={`${base}/work`} viewId="work" className="mb-4"
      leading={<WorkTypeSelect types={types} value={selectedType.id} hrefs={Object.fromEntries(types.map(type => [type.id, href({ type: type.id })]))} />}
      search={{ name: 'q', value: view.q, label: 'Search work', placeholder: 'Search work titles' }}
      hidden={{ view: view.view === 'board' ? 'board' : undefined }}
      filterCount={view.status ? 1 : 0}
      filters={view.view === 'list' ? <label className="flex flex-col gap-1 text-sm sm:col-span-2">Status<SelectInput name="status" aria-label="Filter by status" defaultValue={view.status ?? ''}><option value="">Any status</option>{statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></label> : undefined}
      sort={<SelectInput name="sort" aria-label="Sort work" defaultValue={view.sort} className="w-full md:w-40">{WORK_SORTS.filter(([key]) => scheduled || key !== 'schedule').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectInput>}
      display={<ViewNav label="Work presentation" size="small" className="mb-0" items={[{ key: 'list', label: 'List', href: href({ view: 'list' }), current: view.view === 'list' }, { key: 'board', label: 'Board', href: href({ view: 'board' }), current: view.view === 'board' }]} />}
      active={active} resetHref={filtered ? href({ q: '', status: undefined }) : undefined} />
    <section aria-label={`${typeName} work`} className="min-w-0">
      <p role="status" className="mb-2 text-sm text-muted"><span className="font-medium tabular-nums text-foreground">{total}</span> {total === 1 ? 'work item' : 'work items'}{filtered ? (total === 1 ? ' matches this view' : ' match this view') : ''}</p>
      {firstRun ? <div data-slot="compact-empty" className="flex flex-col gap-3 rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">No {typeName} work yet.</p>
        {mayAdd ? <NewWorkAction organizationId={organizationId} typeId={selectedType.id} /> : null}
      </div>
        : view.view === 'list' ? <DataTable tableFrom="medium" columns={columns} rows={[...workItems]} rowKey={w => w.id} actions={maySchedule && scheduled ? placement : undefined}
          empty={<>No work matches this view. <Link className="text-accent-text underline underline-offset-4" href={href({ q: '', status: undefined })}>Reset</Link></>} />
        : <>
          <p className="mb-3 text-xs text-muted">Up to 10 per stage, in the chosen order. Counts include every match.</p>
          <Board label={`${typeName} stages`}>
            {statuses.map(status => {
              const rows = stages[status.id] ?? [];
              const count = stages[status.id]?.total ?? 0;
              return <BoardColumn key={status.id} name={status.name} count={count} empty="No work in this stage."
                footer={count > rows.length ? <Link className="text-xs font-medium text-accent-text underline underline-offset-4" href={href({ view: 'list', status: status.id })}>View all {count} in {status.name}</Link> : undefined}>
                {rows.length ? rows.map(item => {
                  const moves = mayMove ? allowedNextStatusIds(transitions, item.status.id).flatMap(id => statusName.has(id) ? [{ id, name: statusName.get(id)! }] : []) : [];
                  const place = maySchedule && item.type.schedulable ? placement(item) : null;
                  return <BoardCard key={item.id} actions={moves.length || place ? <div className="flex flex-wrap items-center gap-2"><MoveWorkItemForm organizationId={organizationId} workItemId={item.id} moves={moves} />{place}</div> : undefined}>
                    <div className="min-w-0"><Link className="block break-words font-medium hover:underline" href={`${base}/work/${item.id}`}>{item.title}</Link>{item.customer ? <span className="block truncate text-xs text-muted">{item.customer.label}</span> : null}</div>
                    {scheduled ? <p className="text-xs text-muted"><span className="tabular-nums">{item.window ? formatWindow(item.window, timezone) : 'Unscheduled'}</span> · {item.resources.map(r => r.label).join(', ') || 'Unassigned'}</p> : null}
                    {shortfall(item.id) ? <p className="text-xs text-danger">{shortfall(item.id)}</p> : null}
                  </BoardCard>;
                }) : null}
              </BoardColumn>;
            })}
          </Board>
        </>}
    </section>
    {view.view === 'list' && (workItems.total > WORK_PAGE_SIZE || view.page > 1) ? <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      {view.page > 1 ? <ButtonLink tone="secondary" size="small" href={href({ page: view.page - 1 })}>Previous</ButtonLink> : <span />}
      <span className="tabular-nums text-muted">Page {view.page} of {pages}</span>
      {view.page * WORK_PAGE_SIZE < workItems.total ? <ButtonLink tone="secondary" size="small" href={href({ page: view.page + 1 })}>Next</ButtonLink> : <span />}
    </nav> : null}
  </>;
}
