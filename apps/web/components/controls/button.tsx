import Link from 'next/link';
import type { ComponentProps } from 'react';
import { Button as ShadcnButton } from '@gold/ui/components/button';
import { cx, FOCUS_RING } from '@/components/class-names';

/** The one button set (D23) — extended per surface, never duplicated. */
export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'text' | 'soft' | 'ghost';
export type ButtonSize = 'default' | 'small' | 'tiny';

/**
 * `primary` reads `--accent`/`--on-accent`, which default to `--foreground`/`--background`
 * (globals.css) — an unbranded tenant renders the old style, a branded one gets its own.
 * `danger` keeps its own role rather than following the tenant's colour.
 */
const TONE = { primary: 'default', secondary: 'outline', danger: 'destructive', text: 'link', soft: 'soft', ghost: 'ghost' } as const;
const SIZE = { default: 'default', small: 'sm', tiny: 'xs' } as const;

export function Button({
  tone = 'primary',
  size = 'default',
  className,
  loading = false,
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone; size?: ButtonSize; loading?: boolean }) {
  return <ShadcnButton {...props} loading={loading} variant={TONE[tone]} size={SIZE[size]} className={cx(FOCUS_RING, className)} />;
}

/** An anchor styled as a button, never a button doing navigation — browsers treat the two differently (new tab, history, screen readers). */
export function ButtonLink({
  tone = 'secondary',
  size = 'default',
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: ButtonTone; size?: ButtonSize }) {
  return (
    <ShadcnButton asChild variant={TONE[tone]} size={SIZE[size]} className={cx(FOCUS_RING, className)}>
      <Link {...props} />
    </ShadcnButton>
  );
}
