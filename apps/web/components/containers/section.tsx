import type { ComponentProps, ElementType } from 'react';
import { Hint } from '../controls/inputs';
import { cx } from '../class-names';

/**
 * The page furniture: a ruled section, the two headings, a divided list, and the sentence a
 * screen shows when it has nothing to list.
 *
 * `docs/ui-spec.md` §4: the section rule was 24 hand-written spellings across two, the divided
 * list 21, and every empty state was a bare paragraph with no shared treatment.
 *
 * **Spacing stays at the call site.** These carry the rule, the divider and the type scale —
 * never a margin — because `mt-8` and `mt-10` were both in use and neither is wrong. A control
 * that set its own outer margin would be deciding something about a page it cannot see.
 */
export function Section({ className, ...props }: ComponentProps<'section'>) {
  return <section {...props} className={cx('border-t border-border pt-6', className)} />;
}

/**
 * The page's own heading.
 *
 * An *area* page never renders one — `navigation.ts` holds the noun and `org-shell.tsx` renders
 * it, so one string is both the navigation entry and the `<h1>`. A detail route does, because
 * its heading is the job's title or the customer's name rather than a platform noun.
 */
export function PageHeading({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 {...props} className={cx('text-2xl font-semibold', className)} />;
}

/**
 * The heading of a section — the most repeated single thing in the application, at 52 call
 * sites, and the one this file first failed to model.
 *
 * It is small and weighted rather than large, because an operator screen is a stack of many
 * sections and a heading that shouted would make each one look like a page. `PageHeading` is
 * the page; this is a part of it.
 */
export function SectionHeading({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 {...props} className={cx('text-sm font-medium', className)} />;
}

/** The small label over a group inside a screen — *If*, *Then*, *Recently*, *Sent*. */
export function GroupHeading({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      {...props}
      className={cx('text-xs uppercase tracking-wide text-subtle', className)}
    />
  );
}

/**
 * A list whose items are ruled apart.
 *
 * `as` exists because the application already had four of these on a `div` and two on an `ol`,
 * and an ordered list is not a `ul` with different styling.
 */
export function DividedList<T extends ElementType = 'ul'>({
  as,
  className,
  ...props
}: { as?: T } & Omit<ComponentProps<'ul'>, 'ref'>) {
  const Element = (as ?? 'ul') as ElementType;
  return <Element {...props} className={cx('divide-y divide-border', className)} />;
}

/**
 * What a screen says when it has nothing to show.
 *
 * ui-spec §8: this is application state and stays in code. *No customers yet* is a fact about
 * the database; *add your first customer to get started* is advice the platform has no standing
 * to give, and belongs to nobody but the business.
 *
 * It renders exactly as `Hint` and exists for the name, which is what carries that rule. The two
 * kept the same two weights the screens were already using rather than being flattened into one:
 * an empty section inside a card reads quieter than an empty page, and that was a real choice.
 */
export function EmptyState(props: ComponentProps<typeof Hint>) {
  return <Hint {...props} />;
}
