import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cx, FOCUS_RING } from '../class-names';

/** The one button set (D23) — extended per surface, never duplicated. */
export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'text';
export type ButtonSize = 'default' | 'small' | 'tiny';

/**
 * `primary` reads `--accent`/`--on-accent`, which default to `--foreground`/`--background`
 * (globals.css) — an unbranded tenant renders the old style, a branded one gets its own.
 * `danger` keeps its own role rather than following the tenant's colour.
 */
const TONE: Record<Exclude<ButtonTone, 'text'>, string> = {
  primary: 'bg-accent text-on-accent',
  secondary: 'border border-border',
  danger: 'border border-border text-danger',
};

const SIZE: Record<ButtonSize, string> = {
  default: 'px-4 py-2',
  small: 'px-3 py-1 text-sm',
  tiny: 'px-2 py-1 text-xs',
};

const TEXT_SIZE: Record<ButtonSize, string> = {
  default: '',
  small: 'text-sm',
  tiny: 'text-xs',
};

export function Button({
  tone = 'primary',
  size = 'default',
  className,
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone; size?: ButtonSize }) {
  const classes =
    tone === 'text'
      ? cx('underline underline-offset-4 text-muted disabled:opacity-50', FOCUS_RING, TEXT_SIZE[size], className)
      : cx('rounded disabled:opacity-50', FOCUS_RING, TONE[tone], SIZE[size], className);

  return <button {...props} className={classes} />;
}

/** An anchor styled as a button, never a button doing navigation — browsers treat the two differently (new tab, history, screen readers). */
export function ButtonLink({
  tone = 'secondary',
  size = 'default',
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: ButtonTone; size?: ButtonSize }) {
  const classes =
    tone === 'text'
      ? cx('underline underline-offset-4 text-muted', FOCUS_RING, TEXT_SIZE[size], className)
      : cx('inline-block rounded', FOCUS_RING, TONE[tone], SIZE[size], className);

  return <Link {...props} className={classes} />;
}
