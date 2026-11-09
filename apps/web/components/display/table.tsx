import type { ComponentProps, ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell as ShadcnTableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@gold/ui/components/table';
import { cx } from '../class-names';
import { Hint } from '../controls/inputs';
import { EmptyState } from '../surfaces/section';

/**
 * A table above a breakpoint, a list of cards below it. Uses `@container`, not a viewport query —
 * the operator shell's sidebar means viewport width isn't the same as this component's column
 * width. `actions` is a first-class slot rather than a column, so a row's action sits where the
 * reader is already looking. `secondary` columns drop from the narrow rendering only — kept in
 * the card, so nothing is lost.
 */
export type Column<T> = {
  key: string;
  header: string;
  /** Right-aligned, `tabular-nums`. */
  numeric?: boolean;
  /** `primary` becomes the card's heading line. Presentation only; it never changes visibility. */
  emphasis?: 'primary';
  /**
   * Where the column appears. `table-and-card` is the default. `card-only` keeps it out of the wide
   * table, for columns too wide or too secondary to share a row, while the card still shows it.
   */
  visibility?: 'table-and-card' | 'card-only';
  cell: (row: T) => ReactNode;
  /**
   * The card's value, when it should differ from the table cell. Returning null leaves the line out
   * of the card, so a narrow layout shows what was recorded instead of a column of dashes.
   */
  cardValue?: (row: T) => ReactNode | null;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Render prop, not button descriptors — actions are forms with a hidden id. */
  actions?: (row: T) => ReactNode;
  empty: ReactNode;
  /** Offered only at zero rows — the same create trigger the page's header already shows. */
  footer?: ReactNode;
  /** `medium` and `wide` keep cards until a wider container, for tables whose columns would otherwise be clipped. */
  tableFrom?: 'default' | 'medium' | 'wide';
  /**
   * A leading selection control: `header` (select all shown) heads the column and `cell` starts each
   * row and each card; `cardHeader` replaces `header` above the cards, where it has no column to name it.
   * The caller owns what is selected and what can be done with it.
   */
  select?: { header: ReactNode; cell: (row: T) => ReactNode; cardHeader?: ReactNode };
};

// Container breakpoints, spelled out so the class names exist at build time.
const TABLE_FROM = { default: { table: 'hidden overflow-x-auto @min-[38rem]:block', cards: 'flex flex-col gap-3 @min-[38rem]:hidden' }, medium: { table: 'hidden overflow-x-auto @min-[48rem]:block', cards: 'flex flex-col gap-3 @min-[48rem]:hidden' }, wide: { table: 'hidden overflow-x-auto @min-[64rem]:block', cards: 'flex flex-col gap-3 @min-[64rem]:hidden' } } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  empty,
  footer,
  tableFrom = 'default',
  select,
}: DataTableProps<T>) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;

  const wide = columns.filter((column) => column.visibility !== 'card-only');

  // `rows` may be a `Counted` (carries `total`) or a plain filtered array with no honest total.
  const total = (rows as Partial<{ total: number }>).total;
  const partial = typeof total === 'number' && total > rows.length;

  return (
    <div className="@container">
      <div className={TABLE_FROM[tableFrom].table}>
        <Table>
          <TableHeader>
            <TableRow>
              {select ? <TableHead scope="col" className="w-10 py-2 pr-2">{select.header}</TableHead> : null}
              {wide.map((column) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className={cx('py-2 pr-4 font-medium', column.numeric && 'text-right')}
                >
                  {column.header}
                </TableHead>
              ))}
              {actions ? (
                <TableHead scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {select ? <ShadcnTableCell className="w-10 py-2 pr-2 align-middle">{select.cell(row)}</ShadcnTableCell> : null}
                {wide.map((column) => (
                  <ShadcnTableCell
                    key={column.key}
                    className={cx(
                      'py-2 pr-4 align-middle',
                      column.numeric && 'text-right tabular-nums',
                    )}
                  >
                    {column.cell(row)}
                  </ShadcnTableCell>
                ))}
                {actions ? (
                  <ShadcnTableCell className="align-middle">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {actions(row)}
                    </div>
                  </ShadcnTableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
          {footer ? <TableFooter>{footer}</TableFooter> : null}
        </Table>
      </div>

      {select ? <div className={cx(TABLE_FROM[tableFrom].cards, 'mb-3 px-3')}>{select.cardHeader ?? select.header}</div> : null}
      <ul className={TABLE_FROM[tableFrom].cards}>
        {rows.map((row) => {
          const heading = columns.filter((column) => column.emphasis === 'primary');
          const rest = columns.filter((column) => column.emphasis !== 'primary');
          // A row with nothing to act on draws no empty action strip.
          const rowActions = actions ? actions(row) : null;

          return (
            <li key={rowKey(row)} className="rounded border border-border p-3">
              {heading.map((column) => (
                <div key={column.key} className={cx('font-medium', select && 'flex items-start gap-3')}>
                  {select ? <><span className="pt-0.5">{select.cell(row)}</span><div className="min-w-0 flex-1">{column.cell(row)}</div></> : column.cell(row)}
                </div>
              ))}

              <dl className={cx('grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1', heading.length > 0 && 'mt-2')}>
                {rest.map((column) => {
                  const value = column.cardValue ? column.cardValue(row) : column.cell(row);
                  if (value === null) return null;
                  return (
                    <div key={column.key} className="contents">
                      <dt className="text-sm text-subtle">{column.header}</dt>
                      <dd className={cx('text-sm', column.numeric && 'tabular-nums')}>{value}</dd>
                    </div>
                  );
                })}
              </dl>

              {rowActions ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {rowActions}
                </div>
              ) : null}
            </li>
          );
        })}
        {footer ? <li className="rounded border border-border p-3 text-sm">{footer}</li> : null}
      </ul>

      {partial ? (
        <Hint weight="subtle" className="mt-3">
          Showing {rows.length} of {total}.
        </Hint>
      ) : null}
    </div>
  );
}

/** For a fixed-column report table with no row actions — `DataTable` assumes both. */
export function TableScroll({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cx('w-full overflow-x-auto', className)} />;
}

export function TableHeaderCell({
  numeric,
  className,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <TableHead
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
    <ShadcnTableCell
      {...props}
      className={cx('py-2 pr-4 align-middle', numeric && 'text-right tabular-nums', className)}
    />
  );
}
