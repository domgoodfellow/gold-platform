import type { ComponentProps, ElementType, ReactNode } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@gold/ui/components/empty';
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
 * An empty state describes the truth and may offer concise, honest next-step guidance
 * (`docs/ui-system.md`) — never misleading, manipulative or a duplicate of a create control the
 * page already shows continuously.
 *
 * Two scales, chosen by what is given. Plain `children` with nothing else — "No matching rows",
 * "Nothing metered recently" — renders as inline `Hint` text: a filtered or minor zero-content
 * region does not deserve a bordered box. Passing `title` (optionally with `description`, `media`
 * or `action`) renders the full `@gold/ui` `Empty` composition for a major zero-content region —
 * "This workspace has never been configured" — where the action, if any, stays visually attached
 * to the message rather than drifting to a header's `justify-between` far edge.
 */
export function EmptyState({
  title,
  description,
  media,
  action,
  children,
  className,
  ...hintProps
}: {
  title?: ReactNode;
  description?: ReactNode;
  media?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof Hint>, 'title' | 'children' | 'className'>) {
  if (!title && !media && !action) {
    return (
      <Hint className={className} {...hintProps}>
        {children}
      </Hint>
    );
  }
  return (
    <Empty className={className}>
      <EmptyHeader>
        {media ? <EmptyMedia>{media}</EmptyMedia> : null}
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children || action ? (
        <EmptyContent>
          {children}
          {action}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
