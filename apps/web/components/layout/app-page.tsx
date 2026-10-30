import { Suspense, type ComponentProps } from 'react';
import { SetupReturnLink } from '@/components/navigation/setup-return-link';
import { cx } from '../class-names';

/**
 * The one page frame: every page's header, local navigation, toolbar and content are children of
 * it, so they share one left and one right edge. Route authors choose a mode, never a width.
 *
 * `fluid` is the default and fills whatever the workspace leaves it — beside the sidebar, and
 * beside an open Configure or form drawer, which shrinks the workspace rather than changing the
 * page. Operational and collection pages are always fluid: a cap on one pulls it out of line with
 * its neighbours the moment the viewport outgrows it.
 *
 * `form` and `reading` are deliberate, bounded, centred layouts for a single focused task.
 */
export type PageWidth = 'fluid' | 'form' | 'reading';

const widths: Record<PageWidth, string> = {
  fluid: 'w-full',
  form: 'w-full max-w-4xl mx-auto',
  reading: 'w-full max-w-3xl mx-auto',
};

export function AppPage({
  width = 'fluid',
  className,
  ...props
}: ComponentProps<'div'> & { width?: PageWidth }) {
  const { children, ...rest } = props;
  return <div {...rest} className={cx('min-w-0', widths[width], className)}><Suspense fallback={null}><SetupReturnLink /></Suspense>{children}</div>;
}
