import { ViewNav } from '@/components/navigation/view-nav';

/** Economics' two views, each offered only where its catalogue feature is available. */
export function EconomicsViews({ organizationId, current, portfolio, packages }: { organizationId: string; current: 'portfolio' | 'packages'; portfolio: boolean; packages: boolean }) {
  const base = `/organizations/${organizationId}/finance/economics`;
  const views = [
    ...(portfolio ? [{ key: 'portfolio', label: 'Portfolio', href: base }] : []),
    ...(packages ? [{ key: 'packages', label: 'Packages', href: `${base}/packages` }] : []),
  ];
  return views.length > 1 ? <ViewNav label="Economics" current={current} views={views} /> : null;
}
