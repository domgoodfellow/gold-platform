import type { ReactNode } from 'react';
import { cx } from '../class-names';

export type StatusItem = { label: string; value: ReactNode; emphasis?: boolean; href?: string };

/**
 * Compact labelled chips for independent classifications (lifecycle, temperature, stage) or small
 * counts. Each chip keeps its label, so values that look alike are never confused with one another,
 * and nothing is coloured by what a tenant's word means (`docs/ui-system.md`).
 */
export function StatusSummary({ items, label, className }: { items: StatusItem[]; label?: string; className?: string }) {
  const shown = items.filter(item => item.value !== null && item.value !== undefined && item.value !== '');
  if (!shown.length) return null;
  return <dl aria-label={label} data-slot="status-summary" className={cx('flex flex-wrap gap-1.5', className)}>
    {shown.map(item => <div key={item.label} className={cx('inline-flex items-baseline gap-1.5 rounded-[var(--visual-radius,0.625rem)] border px-2 py-0.5 text-xs',
      item.emphasis ? 'border-accent/40 bg-[var(--surface-accent)]' : 'border-border bg-surface')}>
      <dt className="text-muted">{item.label}</dt><dd className="font-medium text-foreground">{item.value}</dd>
    </div>)}
  </dl>;
}
