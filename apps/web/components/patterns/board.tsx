import type { ReactNode } from 'react';
import { cx, FOCUS_RING } from '../class-names';

/**
 * A board of columns that scrolls sideways inside itself, never the page. The scroll region is a
 * labelled, focusable landmark, so keyboard users can reach it and scroll it with the arrow keys;
 * every card's own links and controls stay in reading order (column by column, top to bottom).
 */
export function Board({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div role="region" aria-label={label} tabIndex={0} data-slot="board"
    className={cx('flex min-w-0 snap-x gap-3 overflow-x-auto overscroll-x-contain pb-3', FOCUS_RING, className)}>{children}</div>;
}

/**
 * One column: its name, a count, optional quieter metadata (a classification, totals), the cards,
 * and an optional footer link. An empty column stays short instead of reserving a tall blank area.
 */
export function BoardColumn({ name, count, meta, children, empty, footer }: {
  name: string; count: number; meta?: ReactNode; children?: ReactNode; empty: ReactNode; footer?: ReactNode;
}) {
  return <section aria-label={name} data-slot="board-column" className="flex w-[min(18rem,82vw)] shrink-0 snap-start flex-col self-start overflow-hidden rounded-[var(--visual-radius,0.625rem)] border border-border bg-secondary/40">
    <header className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
      <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{name}</h2>{meta ? <div className="text-xs text-muted">{meta}</div> : null}</div>
      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>
    </header>
    {children ? <ul className="flex flex-col gap-2 px-2 pb-2">{children}</ul> : <p className="px-3 pb-3 text-xs text-muted">{empty}</p>}
    {footer ? <div className="border-t border-border px-3 py-2">{footer}</div> : null}
  </section>;
}

/** A card on a board: primary identity first, then secondary metadata, then its own actions. */
export function BoardCard({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return <li data-slot="board-card" className="flex flex-col gap-2 rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface p-3 text-sm shadow-[var(--visual-elevation)]">
    {children}{actions ? <div className="border-t border-border pt-2">{actions}</div> : null}
  </li>;
}
