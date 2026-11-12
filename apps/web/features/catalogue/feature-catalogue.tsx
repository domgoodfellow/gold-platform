'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { Hint, TextInput } from '@/components/controls/inputs';
import { Alert } from '@gold/ui/components/alert';
import { Toolbar } from '@/components/display/data';
import { Card } from '@/components/surfaces/card';
import { EmptyState } from '@/components/surfaces/section';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import { featureOperationalState, isOperationalFeature, type FeatureOperationalState } from '@/lib/domain/catalogue/feature-operational-state';
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

type OperationalFilter = Extract<FeatureOperationalState, 'ready' | 'setup_required' | 'disabled'>;

const FILTERS: { key: OperationalFilter | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'On' },
  { key: 'setup_required', label: 'Needs setup' },
  { key: 'disabled', label: 'Disabled' },
];

/**
 * Settings → Features as operational settings: only what this business can actually use, grouped
 * by product, with its setup and on/off actions. Planned or partly built capability is not shown
 * here at all (development status is not operational readiness), and what the plan does not
 * include is one link to Plan & usage rather than an upgrade list inside settings. A setup reason
 * shared by several features is said once per product, or once for the page when it spans
 * products. Search and the status filters narrow the list in place.
 */
export function FeatureCatalogue({ organizationId, features, mayManage }: { organizationId: string; features: CatalogueFeature[]; mayManage: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OperationalFilter | 'all'>('all');
  const classified = useMemo(() => features.map((feature) => ({ feature, status: featureOperationalState(feature.state) })), [features]);
  const operational = classified.filter(({ status }) => isOperationalFeature(status));
  const notIncludedCount = classified.filter(({ status }) => status === 'not_included').length;
  const counts = useMemo(() => {
    const result: Record<OperationalFilter, number> = { ready: 0, setup_required: 0, disabled: 0 };
    for (const { status } of operational) result[status as OperationalFilter] += 1;
    return result;
  }, [operational]);
  const needle = query.trim().toLowerCase();
  const matches = operational
    .filter(({ status, feature }) =>
      (filter === 'all' || status === filter) &&
      (!needle || `${feature.label} ${feature.description} ${feature.module} ${feature.product}`.toLowerCase().includes(needle)));
  const products = [...new Set(matches.map(({ feature }) => feature.product))];
  // A setup reason shared by several products is said once for the page; one product's own, once for that product.
  const reasonProducts = new Map<string, Set<string>>();
  const reasonFeatures = new Map<string, string[]>();
  for (const { feature, status } of matches) {
    if (status !== 'setup_required' || !feature.state.reason) continue;
    reasonProducts.set(feature.state.reason, (reasonProducts.get(feature.state.reason) ?? new Set()).add(feature.product));
    reasonFeatures.set(feature.state.reason, [...(reasonFeatures.get(feature.state.reason) ?? []), feature.label]);
  }
  const pageReasons = [...reasonProducts].filter(([, products]) => products.size > 1).map(([reason]) => reason);

  return (
    <div className="mt-4 grid gap-4">
      <Toolbar variant="outlined">
        <label className="relative block min-w-56 flex-1">
          <span className="sr-only">Search features</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <TextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search features" className="pl-8" />
        </label>
        <div role="group" aria-label="Show features" className="flex flex-wrap gap-1">
          {FILTERS.map(({ key, label }) => {
            const count = key === 'all' ? operational.length : counts[key];
            if (key !== 'all' && count === 0) return null;
            return (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
                className={cx('rounded-md px-2.5 py-1 text-xs', filter === key ? 'bg-selected font-medium' : 'text-muted hover:bg-hover', FOCUS_RING)}>
                {label} <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </Toolbar>
      <p role="status" className="sr-only">{matches.length} features shown</p>

      {pageReasons.length ? <Alert role="note" variant="warning" className="block text-xs">{pageReasons.map((reason) => <p key={reason}><span className="font-medium">Needs setup:</span> {reason} <span>Affects {reasonFeatures.get(reason)!.join(', ')}.</span></p>)}</Alert> : null}
      {products.length === 0 ? <EmptyState>{operational.length === 0 ? 'No features are included for this business yet.' : `No features match${needle ? ` “${query.trim()}”` : ''}.`}</EmptyState> : null}

      {products.map((product) => {
        const inProduct = matches.filter(({ feature }) => feature.product === product);
        const reasons = [...new Set(inProduct.filter(({ status }) => status === 'setup_required').map(({ feature }) => feature.state.reason).filter((reason): reason is string => !!reason && !pageReasons.includes(reason)))];
        const headingId = `features-${product.replace(/\W+/g, '-').toLowerCase()}`;
        return (
          <Card as="section" key={product} aria-labelledby={headingId} className="p-0 py-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
              <h2 id={headingId} className="text-sm font-semibold">{product}</h2>
              <p className="text-xs text-muted">{inProduct.length} included</p>
            </div>
            {reasons.length ? <div className="border-b border-border bg-warning/10 px-4 py-2 text-xs">{reasons.map((reason) => <p key={reason}><span className="font-medium">Needs setup:</span> {reason}</p>)}</div> : null}
            <div className="divide-y divide-border px-4">
              {inProduct.map(({ feature }) => (
                <FeatureRow key={feature.id} organizationId={organizationId} label={feature.label} description={feature.description} meta={feature.module} state={feature.state} mayManage={mayManage} mayConfigure={feature.mayConfigure} showReason={false} />
              ))}
            </div>
          </Card>
        );
      })}

      {notIncludedCount ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Hint>{notIncludedCount === 1 ? '1 more feature is' : `${notIncludedCount} more features are`} available on other plans.</Hint>
          <ButtonLink href={`/organizations/${organizationId}/settings/plan`} tone="secondary" size="small">View plan &amp; usage</ButtonLink>
        </div>
      ) : null}
      {!mayManage ? <Hint>Your role cannot switch features on or off for this business.</Hint> : null}
    </div>
  );
}
