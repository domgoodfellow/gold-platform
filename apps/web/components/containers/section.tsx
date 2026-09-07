import type { ComponentProps, ElementType } from 'react';
import { Hint } from '../controls/inputs';
import { cx } from '../class-names';

/** Spacing stays at the call site — this owns only the rule, divider, and type scale. */
export function Section({ className, ...props }: ComponentProps<'section'>) {
  return <section {...props} className={cx('border-t border-border pt-6', className)} />;
}

/** An area page never renders this — `navigation.ts`/`org-shell.tsx` already supply the heading. Detail routes do. */
export function PageHeading({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 {...props} className={cx('text-2xl font-semibold', className)} />;
}

export function SectionHeading({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 {...props} className={cx('text-sm font-medium', className)} />;
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

/** Application state, not advice (ui-spec §8) — "no customers yet", never "add your first customer". */
export function EmptyState(props: ComponentProps<typeof Hint>) {
  return <Hint {...props} />;
}
