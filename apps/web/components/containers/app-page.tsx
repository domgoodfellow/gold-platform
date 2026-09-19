import type { ComponentProps } from 'react';
import { cx } from '../class-names';

/**
 * The application canvas, deliberately separate from a focused form inside it. Route authors
 * choose a product mode rather than hand-writing arbitrary width utilities.
 *
 * `reading` and `form` are focused, single-task layouts and stay centred. `standard`, `wide` and
 * `full` are operational canvases that sit beside a sidebar; centring one of those pulls its
 * content away from the sidebar the moment the viewport exceeds its cap, so a `wide` list page
 * drifts out of alignment with a `full` one on the same monitor. All three stay flush left.
 */
export type PageWidth = 'reading' | 'form' | 'standard' | 'wide' | 'full';

const widths: Record<PageWidth, string> = {
  reading: 'w-full max-w-3xl mx-auto',
  form: 'w-full max-w-4xl mx-auto',
  standard: 'w-full max-w-screen-xl',
  wide: 'w-full max-w-[90rem]',
  full: 'w-full max-w-none',
};

export function AppPage({
  width = 'standard',
  className,
  ...props
}: ComponentProps<'div'> & { width?: PageWidth }) {
  return <div {...props} className={cx('min-w-0', widths[width], className)} />;
}
