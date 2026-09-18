import type { LucideIcon } from 'lucide-react';
import { cx } from '@/components/class-names';

export interface ProductPreviewRow {
  lead: string;
  title: string;
  detail?: string;
}

export interface ProductPreviewProps {
  /** The label in the preview's own header bar — the area of the product being shown. */
  areaLabel: string;
  nav: { icon: LucideIcon; label: string; active?: boolean }[];
  stats?: { label: string; value: string }[];
  rows: ProductPreviewRow[];
}

/**
 * A reusable, illustrative rendering of GOLD's own interface — not a screenshot, so it stays
 * accurate as the real screens change, but built from the same visual language (`Today`'s
 * sidebar rows, tabular data, a muted header bar) so a visitor recognizes the product rather
 * than a mockup of one. Always paired with "Example configuration" in the header, never implying
 * real tenant data.
 */
export function ProductPreview({ areaLabel, nav, stats, rows }: ProductPreviewProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold">{areaLabel}</span>
        <span className="font-mono text-xs text-subtle">Example configuration</span>
      </div>
      <div className="grid sm:grid-cols-[150px_1fr]">
        <nav aria-label={`${areaLabel} preview`} className="hidden border-r border-border p-3 sm:block">
          {nav.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={cx(
                'flex items-center gap-2 rounded px-2.5 py-2 text-xs',
                active ? 'bg-foreground font-medium text-background' : 'text-muted',
              )}
            >
              <Icon aria-hidden size={14} />
              {label}
            </div>
          ))}
        </nav>
        <div className="p-4 sm:p-5">
          {stats ? (
            <div className="grid grid-cols-2 gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="border-t-2 border-foreground pt-3">
                  <p className="text-xs text-muted">{stat.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className={cx('divide-y divide-border border-y border-border', stats && 'mt-6')}>
            {rows.map((row) => (
              <div
                key={`${row.lead}-${row.title}`}
                className="grid grid-cols-[3.5rem_1fr] gap-3 py-3 text-xs sm:grid-cols-[3.5rem_1fr_auto]"
              >
                <span className="font-mono text-subtle">{row.lead}</span>
                <span className="font-medium">{row.title}</span>
                <span className="hidden text-muted sm:block">{row.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
