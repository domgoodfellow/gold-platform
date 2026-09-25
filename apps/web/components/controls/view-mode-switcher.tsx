'use client';

import type { ComponentType } from 'react';
import { LayoutGrid, List, Table2 } from 'lucide-react';
import { cx, FOCUS_RING } from '../class-names';

/**
 * How one collection is drawn. It is a **representation** of the same records — never a different
 * resource, scope or route — and it is independent of density (compact against comfortable), which
 * is a separate concern a caller adds beside it, never a fourth value here. `map` and `board` join
 * the union when a surface that draws one exists.
 */
export type CollectionPresentation = 'table' | 'list' | 'grid';

const PRESENTATIONS: Record<CollectionPresentation, { label: string; Icon: ComponentType<{ 'aria-hidden'?: boolean; className?: string }> }> = {
  table: { label: 'Table', Icon: Table2 },
  list: { label: 'List', Icon: List },
  grid: { label: 'Grid', Icon: LayoutGrid },
};

/**
 * The three navigation primitives are different questions and stay different components:
 * this switches **how** the same content is drawn (`ViewModeSwitcher`); `ViewNav` moves between
 * sibling views that are their own URLs; a section nav moves within one long page. This one is a
 * group of toggle buttons rather than tabs — it selects nothing to navigate to.
 */
export function ViewModeSwitcher({
  supported,
  value,
  onChange,
  label = 'Layout',
  className,
}: {
  supported: readonly CollectionPresentation[];
  value: CollectionPresentation;
  onChange: (next: CollectionPresentation) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex rounded border border-border p-0.5', className)}>
      {supported.map((presentation) => {
        const { label: name, Icon } = PRESENTATIONS[presentation];
        const active = presentation === value;
        return (
          <button
            key={presentation}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(presentation)}
            className={cx(
              FOCUS_RING,
              'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm',
              active ? 'bg-foreground font-medium text-background' : 'text-muted hover:bg-hover',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {name}
          </button>
        );
      })}
    </div>
  );
}
