import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Maximize2, MoveLeft } from 'lucide-react';
import { cx, FOCUS_RING } from '../class-names';

/**
 * A dashboard: tiles you read at a glance, any of which opens as the screen.
 *
 * **Not the same noun as `dashboards` in `lib/domain/reporting/`, and the difference decides
 * what may be built here.** That one is a business's own arrangement of saved reports, and
 * `CLAUDE.md` forbids the platform seeding one — including the four `roadmap.md` names — because
 * which numbers a business watches is configuration and not four screens. This is the other
 * thing: how an *area* presents itself, which has always been the platform's to design. Today
 * opens onto its widgets the way Work opens onto a table. A business still builds report
 * dashboards on top, and nothing here seeds one.
 *
 * **The expanded view is a URL, not a piece of state.** `?widget=<key>` on the area's own page,
 * the same shape the Reports screen already uses for `?dashboard=`. So the back button works, the
 * view can be sent to somebody, and the data for it is read on the server under RLS like every
 * other screen — none of which is true of a panel opened by a click a component remembers.
 */

/**
 * The grid. Flex rather than `grid-cols-*` at three breakpoints, because the useful rule here is
 * about the tile and not about the viewport: *no narrower than 18rem, otherwise share the row*.
 * Two tiles fit side by side at 40rem, four at 80rem, and one column on a phone falls out of the
 * same line rather than being declared separately. A tile that must not share a row says so
 * itself with `wide`.
 */
export function WidgetGrid({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cx('flex flex-wrap items-stretch gap-4', className)} />;
}

/**
 * One tile.
 *
 * **The title is the link, not the whole tile.** A tile whose every pixel navigates cannot hold
 * the preview rows that make it worth looking at — a link inside a link is invalid, and the
 * overlay trick that works around it swallows text selection and puts every inner link behind a
 * stacking context. The title row spans the tile's full width and carries the expand mark, which
 * is a large and obvious target; the rows underneath keep their own links to the thing they name.
 */
export function Widget({
  title,
  value,
  note,
  href,
  wide = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title: ReactNode;
  /** The one figure this tile is about, when it has one. */
  value?: ReactNode;
  /** What the figure means, in the platform's voice — never advice (`ui-spec.md` §8). */
  note?: ReactNode;
  /** Where this tile opens. Absent for a tile with nothing more to show than it already shows. */
  href?: string;
  /** Takes two tiles' width where there is room for it. */
  wide?: boolean;
}) {
  const heading = (
    <>
      <span className="min-w-0 truncate">{title}</span>
      {href ? <Maximize2 aria-hidden size={14} className="shrink-0 text-subtle" /> : null}
    </>
  );

  return (
    <section
      {...props}
      className={cx(
        'flex min-w-0 flex-1 flex-col rounded border border-border p-4',
        wide ? 'basis-[36rem]' : 'basis-72',
        className,
      )}
    >
      <h2 className="text-base font-semibold">
        {href ? (
          <Link
            href={href}
            className={cx(
              'flex items-center justify-between gap-2 rounded underline-offset-4 hover:underline',
              FOCUS_RING,
            )}
          >
            {heading}
          </Link>
        ) : (
          <span className="flex items-center justify-between gap-2">{heading}</span>
        )}
      </h2>

      {value === undefined ? null : (
        <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      )}
      {note === undefined ? null : <p className="mt-1 text-sm text-muted">{note}</p>}

      {/* `flex-1` so tiles sharing a row end level whatever their contents. */}
      {children === undefined ? null : <div className="mt-3 min-w-0 flex-1">{children}</div>}
    </section>
  );
}

/**
 * A widget opened as the screen — what `href` above leads to.
 *
 * It replaces the grid rather than covering it, so there is nothing to trap focus in and nothing
 * to close: the way out is the way back, which is a link and therefore also the browser's back
 * button.
 */
export function WidgetPanel({
  title,
  backHref,
  backLabel,
  children,
}: {
  title: ReactNode;
  backHref: string;
  /** The area's own name — the thing being returned to, never the word "back" alone. */
  backLabel: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <Link
        href={backHref}
        className={cx(
          'inline-flex items-center gap-2 rounded text-sm text-muted underline-offset-4 hover:underline',
          FOCUS_RING,
        )}
      >
        <MoveLeft aria-hidden size={16} className="shrink-0" />
        {backLabel}
      </Link>

      <h2 className="mt-3 text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
