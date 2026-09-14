import type { ComponentProps, ElementType, ReactNode } from 'react';
import { Hint } from '../controls/inputs';
import { cx } from '../class-names';

/** Spacing stays at the call site — this owns only the rule, divider, and type scale. */
export function Section({ className, ...props }: ComponentProps<'section'>) {
  return <section {...props} className={cx('border-t border-border pt-6', className)} />;
}

/**
 * The type scale, and the one thing about it worth writing down.
 *
 * `SectionHeading` was `text-sm font-medium` — the same size as body text, a shade heavier. So a
 * screen was one large title followed by an undifferentiated wall, and a reader had no way to
 * tell the start of a section from a sentence inside one without reading both. Three steps that
 * are actually distinguishable: 24px for what the page is, 16px semibold for a section of it,
 * 12px uppercase for a group inside a section, against 14px body.
 */

/** An area page never renders this — `navigation.ts`/`org-shell.tsx` already supply the heading. Detail routes do. */
export function PageHeading({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 {...props} className={cx('text-2xl font-semibold tracking-tight', className)} />;
}

export function SectionHeading({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 {...props} className={cx('text-base font-semibold', className)} />;
}

/** Label over a group inside a screen — *If*, *Then*, *Recently*, *Sent*. */
export function GroupHeading({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      {...props}
      className={cx('text-xs uppercase tracking-wide text-subtle', className)}
    />
  );
}

/** `as` because not every list is a `ul` — some are genuinely ordered. */
export function DividedList<T extends ElementType = 'ul'>({
  as,
  className,
  ...props
}: { as?: T } & Omit<ComponentProps<'ul'>, 'ref'>) {
  const Element = (as ?? 'ul') as ElementType;
  return <Element {...props} className={cx('divide-y divide-border', className)} />;
}

/**
 * Application state, not advice (ui-spec §8) — "no customers yet", never "add your first
 * customer". `action` is the one exception: the same create trigger the populated collection's
 * header already offers, surfaced again where the empty body area would otherwise say nothing
 * can be done — not advice, the identical control.
 */
export function EmptyState({
  action,
  className,
  ...props
}: ComponentProps<typeof Hint> & { action?: ReactNode }) {
  if (!action) return <Hint {...props} className={className} />;
  return (
    <div className={cx('flex flex-col items-start gap-3', className)}>
      <Hint {...props} />
      {action}
    </div>
  );
}
