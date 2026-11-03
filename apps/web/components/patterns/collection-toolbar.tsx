import Link from 'next/link';
import type { ReactNode } from 'react';
import { Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../controls/button';
import { TextInput } from '../controls/inputs';
import { ViewNav, type ViewNavItem } from '../navigation/view-nav';
import { cx, FOCUS_RING } from '../class-names';

export type ActiveFilter = { key: string; label: ReactNode; removeHref: string };

/**
 * A collection's controls, organised by how often they are used: quick scopes and search first,
 * then sort and display, with the less frequent criteria inside a Filters panel. Everything is a
 * plain GET form, so the URL stays the one view model and the database stays the one filter
 * engine — counts and pagination agree with what is shown. Active filters are listed as removable
 * chips, with a reset that returns to the unfiltered collection.
 */
export function CollectionToolbar({ action, scopes, scopeLabel = 'Views', leading, search, hidden = {}, filters, filterCount = 0, sort, display, active = [], resetHref, className, viewId = 'collection' }: {
  /** The collection's own path; submitting keeps the user here. */
  action: string;
  scopes?: readonly ViewNavItem[]; scopeLabel?: string;
  /** A selector that decides which collection is shown at all (a Work type), placed before search and submitted with it. */
  leading?: ReactNode;
  search?: { name: string; value?: string; label: string; placeholder?: string };
  /** Query parameters that must survive a submit (the current scope, for instance). */
  hidden?: Record<string, string | undefined>;
  filters?: ReactNode; filterCount?: number; sort?: ReactNode; display?: ReactNode;
  active?: ActiveFilter[]; resetHref?: string; className?: string;
  /** Unique per toolbar on the page; ties the View toggle to its panel. */
  viewId?: string;
}) {
  return <div data-slot="collection-toolbar" className={cx('flex flex-col gap-3', className)}>
    {scopes?.length ? <ViewNav label={scopeLabel} items={scopes} className="mb-0 max-sm:max-w-full max-sm:flex-nowrap max-sm:overflow-x-auto" /> : null}
    {/* Keyed by the current view: after a chip removes a filter in place, the form starts again from
        the URL rather than keeping the removed value in an untouched field and sending it back. */}
    <form key={JSON.stringify([hidden, search?.value ?? '', active.map(filter => filter.key + String(filter.removeHref))])} method="get" action={action} role="search" className="relative flex flex-wrap items-start gap-2">
      {Object.entries(hidden).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
      {leading ? <div className="min-w-0 basis-full sm:basis-auto">{leading}</div> : null}
      {search ? <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1 lg:min-w-64">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <TextInput type="search" name={search.name} defaultValue={search.value} aria-label={search.label} placeholder={search.placeholder ?? search.label} className="w-full pl-9" />
      </div> : null}
      {filters ? <details className="group" open={false}>
        <summary className={cx('flex min-h-[var(--control-height,2.25rem)] cursor-pointer list-none items-center gap-2 rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface px-3 text-sm font-medium hover:bg-hover [&::-webkit-details-marker]:hidden', FOCUS_RING)}>
          <SlidersHorizontal aria-hidden className="size-4" />Filters{filterCount ? <span className="rounded-full bg-accent px-1.5 text-xs tabular-nums text-on-accent">{filterCount}</span> : null}
        </summary>
        <div data-slot="filter-panel" className="z-30 mt-2 grid w-full gap-3 rounded-[var(--visual-radius,0.625rem)] border border-border bg-popover p-4 shadow-[var(--visual-overlay-shadow)] sm:grid-cols-2 md:absolute md:left-0 md:w-[min(34rem,100%)]">
          {filters}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="submit" size="small">Apply filters</Button></div>
        </div>
      </details> : null}
      {sort || display ? <>
        {/* One set of fields: inline on wide screens, behind a View toggle below them. The toggle is an
            unnamed checkbox, so it is never submitted and works without script. */}
        <input id={`${viewId}-view`} type="checkbox" className="peer sr-only lg:hidden" aria-controls={`${viewId}-panel`} />
        <label htmlFor={`${viewId}-view`} className={cx('flex min-h-[var(--control-height,2.25rem)] cursor-pointer items-center gap-2 rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface px-3 text-sm font-medium hover:bg-hover peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-[color:var(--focus-color)] lg:hidden')}><Rows3 aria-hidden className="size-4" />View</label>
        <div id={`${viewId}-panel`} data-slot="view-panel" className="hidden w-full flex-col gap-2 peer-checked:flex sm:flex-row sm:flex-wrap lg:flex lg:w-auto lg:flex-row">{sort}{display}</div>
      </> : null}
      <Button type="submit" tone="secondary">Apply</Button>
    </form>
    {active.length ? <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
      {active.map(filter => <Link key={filter.key} href={filter.removeHref} className={cx('inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs hover:bg-hover', FOCUS_RING)}>
        {filter.label}<X aria-hidden className="size-3" /><span className="sr-only">Remove filter</span></Link>)}
      {resetHref ? <Link href={resetHref} className={cx('text-xs font-medium text-accent-text underline underline-offset-4', FOCUS_RING)}>Reset</Link> : null}
    </div> : null}
  </div>;
}
