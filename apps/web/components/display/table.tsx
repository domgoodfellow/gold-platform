import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../class-names';
import { Hint } from '../controls/inputs';
import { EmptyState } from '../containers/section';

/**
 * A table that answers *what needs to happen here*, and stops being a table on a phone.
 *
 * **Two problems, and they are the same problem.** The screens drew rows that were a link and
 * some text underneath it, so what a person could *do* with a row was never on the row — it was
 * on the page you reached by clicking it, or in a form at the bottom of the list. And the two
 * real tables in the application were wrapped in `overflow-x-auto`, which on a phone means the
 * columns that matter are off the right-hand edge and the reader has to drag a table sideways to
 * find out what a number refers to.
 *
 * So a column declares what it is for, and this decides how to draw it:
 *
 * - **`actions` is a first-class slot, not a column.** A row that can be acted on says so, in
 *   the place the reader is already looking. `ui-spec.md` §6 gives one primary action per
 *   *screen*, which is about the page's own call to action and not about a row: a row action is
 *   tertiary by construction, and this renders it that way.
 * - **`numeric` right-aligns and sets `tabular-nums`.** Money in a ragged left-aligned column is
 *   unreadable at a glance, and proportional digits make two amounts of the same magnitude look
 *   different lengths.
 * - **`secondary` columns are dropped from the narrow rendering and kept in the card.** Nothing
 *   is lost, which is the difference between this and hiding a column.
 *
 * **Below a certain width it is a list of cards, not a scrolling table.** Each card is the
 * primary columns as a heading line and everything else as label-and-value pairs, so a value is
 * never separated from the word that says what it is. That is why the header text is required
 * rather than optional: on a narrow screen it is not a header, it is the label on every row.
 *
 * **That width is the container's, not the viewport's, and the first version got this wrong.**
 * It switched on `md:`, which asks how wide the *window* is — and what decides whether a table
 * fits is the column it is drawn in. The operator shell puts a 15rem sidebar beside that column,
 * so a laptop at 1000px gives this component about 44rem and a viewport query would call that
 * "desktop" and draw a table into a space that cannot hold one. A `@container` query asks the
 * question that actually matters, and it keeps being right if this is ever rendered into a
 * narrower column — a dashboard tile, a sheet — with nothing here changed.
 *
 * Both renderings map the same `columns` — never two lists that would eventually disagree — and
 * exactly one is in the accessibility tree at a time, which is the precedent `OrgNav` set for
 * rendering one IA twice.
 */
export type Column<T> = {
  /** Stable identity for the cell, and the key React draws it under. */
  key: string;
  /**
   * The column heading, and on a phone the label beside every value.
   *
   * Required for that reason. A header that reads well only above a column of numbers — `%`,
   * `#` — reads as nothing at all when it is the label on a card.
   */
  header: string;
  /** Right-aligned, `tabular-nums`. Money, counts, durations. */
  numeric?: boolean;
  /**
   * `primary` is the card's heading line; `secondary` is dropped from the wide table and kept
   * in the card. Absent means an ordinary column: shown in both.
   */
  emphasis?: 'primary' | 'secondary';
  cell: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /**
   * What can be done to one row, if anything.
   *
   * A render prop rather than a list of button descriptors, because the actions on a row are
   * forms — a server action with a hidden id — and this component has no business knowing what
   * any of them do.
   */
  actions?: (row: T) => ReactNode;
  /** What the screen says when there is nothing. Application state, never advice (§8). */
  empty: ReactNode;
  /** A totals row, when the numbers add up to something. */
  footer?: ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  empty,
  footer,
}: DataTableProps<T>) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;

  const wide = columns.filter((column) => column.emphasis !== 'secondary');

  // **A partial list says so, and every table gets that without asking.** The domain's list
  // functions return a `Counted` — an array carrying the number of rows the query matches —
  // so a table handed one can tell whether it is looking at all of them. Read defensively
  // because `rows` is typed as a plain array: a caller may hand over something it filtered,
  // and a filtered list has no honest total (see `list-page.ts`).
  const total = (rows as Partial<{ total: number }>).total;
  const partial = typeof total === 'number' && total > rows.length;

  return (
    // `@container` here rather than at the call site: a component whose layout depends on being
    // measured has to be the thing that asks to be measured, or the one caller who forgets gets
    // a silent fallback to the narrow rendering and no error anywhere.
    <div className="@container">
      {/* Wide enough: an actual table, because a table of numbers is what a table is for and a
          reader comparing a column down the page needs the columns to line up. */}
      <div className="hidden @min-[38rem]:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {wide.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cx('py-2 pr-4 font-medium', column.numeric && 'text-right')}
                >
                  {column.header}
                </th>
              ))}
              {actions ? (
                // Named for assistive technology and blank on screen: a column of buttons has no
                // heading a sighted reader needs, and an empty `th` is a gap in the row for
                // anybody navigating it by column.
                <th scope="col" className="py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border/50">
                {wide.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'py-2 pr-4 align-top',
                      column.numeric && 'text-right tabular-nums',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
                {actions ? (
                  <td className="py-2 align-top">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {actions(row)}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>

      {/* Narrow: one card per row. Every column keeps its label, including the ones the wide
          rendering drops, so a narrow column shows *more* about each row rather than less. */}
      <ul className="flex flex-col gap-3 @min-[38rem]:hidden">
        {rows.map((row) => {
          const heading = columns.filter((column) => column.emphasis === 'primary');
          const rest = columns.filter((column) => column.emphasis !== 'primary');

          return (
            <li key={rowKey(row)} className="rounded border border-border p-3">
              {heading.map((column) => (
                <div key={column.key} className="font-medium">
                  {column.cell(row)}
                </div>
              ))}

              <dl className={cx('grid grid-cols-[auto_1fr] gap-x-3 gap-y-1', heading.length > 0 && 'mt-2')}>
                {rest.map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-sm text-subtle">{column.header}</dt>
                    <dd className={cx('text-sm', column.numeric && 'tabular-nums')}>
                      {column.cell(row)}
                    </dd>
                  </div>
                ))}
              </dl>

              {actions ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {actions(row)}
                </div>
              ) : null}
            </li>
          );
        })}
        {footer ? <li className="rounded border border-border p-3 text-sm">{footer}</li> : null}
      </ul>

      {/* Application state in the platform's own voice (§8): a fact about what is on screen,
          not advice about what to do. What to do about it is a filter or a search, and neither
          exists yet — saying nothing was the alternative, and that is the behaviour this whole
          change exists to end. */}
      {partial ? (
        <Hint weight="subtle" className="mt-3">
          Showing {rows.length} of {total}.
        </Hint>
      ) : null}
    </div>
  );
}

/**
 * One row of a table that is genuinely a table rather than a list of things.
 *
 * `DataTable` is for rows a reader scans and acts on. A report is the other kind — a fixed set
 * of columns, a totals row, nothing to do to any line — and forcing it through a component built
 * around row actions would mean an `actions` prop nobody passes and an `emphasis` on every
 * column to say which one is a heading. These two exports are what a report needs and no more:
 * the wrapper that lets a wide table scroll rather than push the page sideways, and the header
 * treatment, so a report's table is styled by the same rules without pretending to be a list.
 */
export function TableScroll({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cx('w-full overflow-x-auto', className)} />;
}

export function TableHeaderCell({
  numeric,
  className,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      {...props}
      className={cx('py-2 pr-4 font-medium', numeric && 'text-right', className)}
    />
  );
}

export function TableCell({
  numeric,
  className,
  ...props
}: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      {...props}
      className={cx('py-2 pr-4 align-top', numeric && 'text-right tabular-nums', className)}
    />
  );
}
