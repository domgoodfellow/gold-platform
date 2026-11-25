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

/**
 * **The frame owns the space between the page's regions** (`docs/ui-system.md`, Vertical rhythm):
 * its direct children — header, local navigation, toolbar, sections, the working surface — are
 * stacked one `--page-gap` apart, and none of them carries an outer margin of its own. The gap
 * follows the person's Display density. What is inside a region is that region's own composition.
 *
 * `fill` is for a height-constrained working surface — a calendar, a board, an inbox, an editor:
 * the frame takes the canvas's remaining height and its last region can fill it and scroll inside.
 */
export function AppPage({
  width = 'fluid',
  fill = false,
  className,
  ...props
}: ComponentProps<'div'> & { width?: PageWidth; fill?: boolean }) {
  const { children, ...rest } = props;
  return <div data-app-page={fill ? 'fill' : ''} {...rest} className={cx('flex min-w-0 flex-col gap-(--page-gap)', fill && 'h-full min-h-0 flex-1', widths[width], className)}><Suspense fallback={null}><SetupReturnLink /></Suspense>{children}</div>;
}
