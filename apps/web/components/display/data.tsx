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
}: ComponentProps<'span'> & { tone?: 'neutral' | 'accent' | 'success' }) {
  return (
    <span
      {...props}
      className={cx(
        'inline-flex items-center rounded px-2 py-0.5 text-xs',
        tone === 'accent'
          ? 'bg-accent text-on-accent'
          : tone === 'success'
            ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
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

/*
  `Stat` and `StatRow` were here: a number in a bordered box, and a row of them that fitted as
  many across as there was room for. `Widget` (`display/widget.tsx`) is the same thing with
  somewhere to go, and the Today screen — their only caller — is now built from widgets, so
  keeping both would have left two boxes with a number in them and no rule for choosing. The one
  claim worth carrying over is on `Widget.note`: no trend and no comparison, because the platform
  cannot tell whether a number moving is good or bad for a business it knows nothing about.
*/

/** One primary action per screen (ui-spec §6). */
export function Toolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('flex flex-wrap items-center justify-between gap-3', className)}
    />
  );
}
