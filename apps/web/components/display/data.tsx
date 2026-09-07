import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../class-names';

/**
 * Never coloured by what the value means (ui-spec §7) — the platform can't tell if a tenant's
 * status word is good or bad. `tone="accent"` is the tenant's own colour, meaning "this one",
 * never "this one is good".
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

/** Renders nothing when empty, so a caller can list every possible field without a ternary per row. */
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

/** No trend or comparison — the platform can't tell whether a number moving is good or bad. */
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

/** `auto-fit` so the count per row follows the space available, not a guessed breakpoint. */
export function StatRow({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]', className)}
    />
  );
}

/** One primary action per screen (ui-spec §6). */
export function Toolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('flex flex-wrap items-center justify-between gap-3', className)}
    />
  );
}
