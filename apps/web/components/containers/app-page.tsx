import type { ComponentProps } from 'react';
import { cx } from '../class-names';

/**
 * The application canvas, deliberately separate from a focused form inside it. Route authors
 * choose a product mode rather than hand-writing arbitrary width utilities.
 */
export type PageWidth = 'reading' | 'form' | 'standard' | 'wide' | 'full';

const widths: Record<PageWidth, string> = {
  reading: 'max-w-3xl',
  form: 'max-w-4xl',
  standard: 'max-w-screen-xl',
  wide: 'max-w-[90rem]',
  full: 'max-w-none',
};

export function AppPage({
  width = 'standard',
  className,
  ...props
}: ComponentProps<'div'> & { width?: PageWidth }) {
  return <div {...props} className={cx('mx-auto w-full min-w-0', widths[width], className)} />;
}
