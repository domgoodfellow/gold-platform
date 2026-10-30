import type { ReactNode } from 'react';
import { cx } from '../class-names';

export type ConfigurationItem = { id: string; label: ReactNode; meta?: ReactNode; actions?: ReactNode };

/**
 * A small ordered set managed in place: the authoritative list is the page, numbered in its stored
 * order, with each item's own actions (edit, move, delete) beside it and adding as the section's
 * action. Editing happens in a focused dialog supplied by the caller; this owns only the layout, so
 * each domain keeps its own rules about what may move, change or be removed.
 */
export function ConfigurationEditor({ label, items, empty, addAction, className, density = 'standard' }: {
  label: string; items: ConfigurationItem[]; empty: ReactNode; addAction?: ReactNode; className?: string; density?: 'standard' | 'compact';
}) {
  return <section aria-label={label} data-slot="configuration-editor" className={cx('overflow-hidden rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface', className)}>
    {items.length ? <ol className="divide-y divide-border">
      {items.map((item, index) => <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs tabular-nums text-muted">{index + 1}</span>
        <span className="min-w-0 flex-1"><span className="block break-words font-medium">{item.label}</span>{item.meta ? <span className="block text-xs text-muted">{item.meta}</span> : null}</span>
        {item.actions ? <span className="flex flex-wrap items-center gap-1">{item.actions}</span> : null}
      </li>)}
    </ol> : <div className={cx('px-4 text-sm text-muted', density === 'compact' ? 'py-3' : 'py-5')}>{empty}</div>}
    {addAction ? <div className="border-t border-border px-4 py-3">{addAction}</div> : null}
  </section>;
}
