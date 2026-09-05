import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../class-names';

/**
 * Three ways of showing one value, and the rule they all obey.
 *
 * **None of them is coloured by what the value means** (`ui-spec.md` §7). A badge holding a
 * tenant's status gets one neutral treatment, because the platform does not know whether
 * *Klaar* is finished or *Awaiting parts* is a problem — they are the same shape of row. This is
 * the single most likely thing here to be undone by somebody being helpful, and the tell is a
 * lookup keyed to an English word.
 *
 * `tone="accent"` is the one variation, and it is not an exception: the accent is the *tenant's*
 * own colour and says *this one*, never *this one is good*. `BrandStyle` guarantees it stays
 * readable whatever colour they chose.
 */
export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'accent' }) {
  return (
    <span
      {...props}
      className={cx(
        'inline-flex items-center rounded px-2 py-0.5 text-xs',
        tone === 'accent'
          ? 'bg-accent text-on-accent'
          : 'border border-border text-muted',
        className,
      )}
    />
  );
}

/**
 * Label-and-value pairs, for a detail screen.
 *
 * A two-column grid rather than a flowing list, so every value starts at the same place down the
 * page — which is what makes a column of them scannable. It collapses to one column below `sm`,
 * because a label and a value fighting for half a phone's width wraps both.
 *
 * `Detail` renders nothing when it has nothing, so a caller can list every field a screen might
 * show without wrapping each one in a ternary. An empty row with a label and a dash tells the
 * reader that something is missing; an absent row tells them the same thing more quietly, and
 * the screens were already choosing that by hand.
 */
export function DefinitionList({ className, ...props }: ComponentProps<'dl'>) {
  return (
    <dl
      {...props}
      className={cx(
        'grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[minmax(8rem,auto)_1fr]',
        className,
      )}
    />
  );
}

export function Detail({ label, children }: { label: ReactNode; children: ReactNode }) {
  if (children === null || children === undefined || children === '' || children === false) {
    return null;
  }

  return (
    <div className="contents">
      <dt className="text-sm text-subtle">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * One figure, big enough to be read from across a van.
 *
 * **The label is above the figure and not below it.** A reader scanning a row of these is
 * looking for the one they want before they read any number, and a number with its meaning
 * underneath makes them read every number first.
 *
 * No trend, no arrow, no comparison against last month. Every one of those is a claim about
 * whether the number is good, and this platform does not know — a business whose invoiced total
 * fell because they took July off is not a business having a bad month.
 */
export function Stat({
  label,
  value,
  note,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div {...props} className={cx('rounded border border-border p-3', className)}>
      <div className="text-xs text-subtle">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {note ? <div className="mt-1 text-xs text-muted">{note}</div> : null}
    </div>
  );
}

/**
 * A row of `Stat`s that wraps rather than scrolls.
 *
 * `auto-fit` with a floor means three across on a laptop, two on a tablet and one on a phone,
 * decided by the space available rather than by a breakpoint somebody guessed — which is the
 * whole of what "flex responsive" should mean for a set of equal things.
 */
export function StatRow({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]', className)}
    />
  );
}

/**
 * A bar above a list: what the page is about on the left, what to do about it on the right.
 *
 * `ui-spec.md` §6 gives one primary action per screen, and until now there was nowhere to put
 * it — so it was a button at the bottom of the page under the form it submitted. It wraps rather
 * than shrinking, so on a phone the action drops beneath the heading at full width instead of
 * squeezing the heading into two characters and an ellipsis.
 */
export function Toolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('flex flex-wrap items-center justify-between gap-3', className)}
    />
  );
}
