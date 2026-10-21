'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { Hint, TextInput } from '@/components/controls/inputs';
import { EmptyState } from '@/components/surfaces/section';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import { FeatureRow } from './feature-row';

export type CatalogueFeature = {
  id: string;
  label: string;
  description: string;
  product: string;
  module: string;
  state: ResolvedFeatureState;
  mayConfigure: boolean;
};

export type FeatureStatus = 'included' | 'setup' | 'disabled' | 'not-included' | 'planned';

/** One status per feature, from the resolved facts only (never re-deciding entitlement). */
export function featureStatus(state: ResolvedFeatureState): FeatureStatus {
  if (state.implementationState === 'planned') return 'planned';
  if (!state.entitled) return 'not-included';
  if (state.activation === 'disabled') return 'disabled';
  if (state.readiness === 'setup_required') return 'setup';
  return 'included';
}

const FILTERS: { key: FeatureStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'included', label: 'Included' },
  { key: 'setup', label: 'Needs setup' },
  { key: 'disabled', label: 'Disabled' },
  { key: 'not-included', label: 'Not in your plan' },
  { key: 'planned', label: 'Planned' },
];

/**
 * Settings → Features as a catalogue a person can find their way through: what is usable first,
 * grouped by product; what the plan does not include, and what is planned but not built, folded
 * beneath each product with one explanation for the whole group rather than a card and a button
 * per feature. A setup reason shared by several features is said once per product. Search and the
 * status filters narrow the catalogue in place; a search opens the folded groups it matches, so
 * nothing is hidden from someone looking for it.
 */
export function FeatureCatalogue({ organizationId, features, mayManage }: { organizationId: string; features: CatalogueFeature[]; mayManage: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FeatureStatus | 'all'>('all');
  const counts = useMemo(() => {
    const result: Record<FeatureStatus, number> = { included: 0, setup: 0, disabled: 0, 'not-included': 0, planned: 0 };
    for (const feature of features) result[featureStatus(feature.state)] += 1;
    return result;
  }, [features]);
  const needle = query.trim().toLowerCase();
  const matches = features.filter((feature) =>
    (filter === 'all' || featureStatus(feature.state) === filter) &&
    (!needle || `${feature.label} ${feature.description} ${feature.module} ${feature.product}`.toLowerCase().includes(needle)));
  const products = [...new Set(matches.map((feature) => feature.product))];
  // Searching or choosing a folded status shows its features; browsing keeps them folded.
  const unfold = !!needle || filter === 'not-included' || filter === 'planned';
  // A setup reason shared by several products is said once for the page; one product's own, once for that product.
  const reasonProducts = new Map<string, Set<string>>();
  const reasonFeatures = new Map<string, string[]>();
  for (const feature of matches) {
    if (featureStatus(feature.state) !== 'setup' || !feature.state.reason) continue;
    reasonProducts.set(feature.state.reason, (reasonProducts.get(feature.state.reason) ?? new Set()).add(feature.product));
    reasonFeatures.set(feature.state.reason, [...(reasonFeatures.get(feature.state.reason) ?? []), feature.label]);
  }
  const pageReasons = [...reasonProducts].filter(([, products]) => products.size > 1).map(([reason]) => reason);

  return (
    <div className="mt-4 grid gap-4">
      <div className="grid gap-3 rounded-lg border border-border bg-surface p-3">
        <label className="relative block">
          <span className="sr-only">Search features</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <TextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search features" className="pl-8" />
        </label>
        <div role="group" aria-label="Show features" className="flex flex-wrap gap-1">
          {FILTERS.map(({ key, label }) => {
            const count = key === 'all' ? features.length : counts[key];
            if (key !== 'all' && count === 0) return null;
            return (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
                className={cx('rounded-md px-2.5 py-1 text-xs', filter === key ? 'bg-selected font-medium' : 'text-muted hover:bg-hover', FOCUS_RING)}>
                {label} <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p role="status" className="sr-only">{matches.length} features shown</p>

      {pageReasons.length ? <div role="note" className="rounded-lg border border-border bg-warning/10 px-4 py-3 text-xs">{pageReasons.map((reason) => <p key={reason}><span className="font-medium">Needs setup:</span> {reason} <span className="text-muted">Affects {reasonFeatures.get(reason)!.join(', ')}.</span></p>)}</div> : null}
      {products.length === 0 ? <EmptyState>No features match{needle ? ` “${query.trim()}”` : ''}.</EmptyState> : null}

      {products.map((product) => {
        const inProduct = matches.filter((feature) => feature.product === product);
        const usable = inProduct.filter((feature) => ['included', 'setup', 'disabled'].includes(featureStatus(feature.state)));
        const notIncluded = inProduct.filter((feature) => featureStatus(feature.state) === 'not-included');
        const planned = inProduct.filter((feature) => featureStatus(feature.state) === 'planned');
        const reasons = [...new Set(usable.filter((feature) => featureStatus(feature.state) === 'setup').map((feature) => feature.state.reason).filter((reason): reason is string => !!reason && !pageReasons.includes(reason)))];
        const headingId = `features-${product.replace(/\W+/g, '-').toLowerCase()}`;
        return (
          <section key={product} aria-labelledby={headingId} className="rounded-lg border border-border bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
              <h2 id={headingId} className="text-sm font-semibold">{product}</h2>
              <p className="text-xs text-muted">{[usable.length && `${usable.length} included`, notIncluded.length && `${notIncluded.length} not in plan`, planned.length && `${planned.length} planned`].filter(Boolean).join(' · ')}</p>
            </div>
            {reasons.length ? <div className="border-b border-border bg-warning/10 px-4 py-2 text-xs">{reasons.map((reason) => <p key={reason}><span className="font-medium">Needs setup:</span> {reason}</p>)}</div> : null}
            {usable.length ? (
              <div className="divide-y divide-border px-4">
                {usable.map((feature) => (
                  <FeatureRow key={feature.id} organizationId={organizationId} label={feature.label} description={feature.description} meta={feature.module} state={feature.state} mayManage={mayManage} mayConfigure={feature.mayConfigure} showReason={false} />
                ))}
              </div>
            ) : null}
            {notIncluded.length ? (
              <FoldedGroup key={`n-${unfold}`} open={unfold} summary={`Not in your plan (${notIncluded.length})`}
                note="These are not part of this business's current plan."
                action={<ButtonLink href={`/organizations/${organizationId}/settings/plan`} tone="secondary" size="small">View plan</ButtonLink>}
                features={notIncluded} />
            ) : null}
            {planned.length ? (
              <FoldedGroup key={`p-${unfold}`} open={unfold} summary={`Planned (${planned.length})`}
                note="Planned for GildOps and not available yet, on any plan."
                features={planned} />
            ) : null}
          </section>
        );
      })}

      {!mayManage ? <Hint>Your role cannot switch features on or off for this business.</Hint> : null}
    </div>
  );
}

function FoldedGroup({ summary, note, action, features, open }: { summary: string; note: string; action?: ReactNode; features: CatalogueFeature[]; open: boolean }) {
  return (
    <details open={open} className="group border-t border-border first:border-t-0">
      <summary className={cx('flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm text-muted hover:bg-hover', FOCUS_RING)}>
        <span><span aria-hidden className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>{summary}</span>
      </summary>
      <div className="px-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 py-1"><Hint>{note}</Hint>{action}</div>
        <ul className="mt-1 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature.id} className="min-w-0 text-sm"><span className="font-medium">{feature.label}</span><span className="block text-xs text-muted">{feature.description}</span></li>
          ))}
        </ul>
      </div>
    </details>
  );
}
