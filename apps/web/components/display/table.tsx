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
import { EmptyState } from '../containers/section';

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
  /** `primary` becomes the card's heading line; `secondary` is dropped from the wide table. */
  emphasis?: 'primary' | 'secondary';
  cell: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Render prop, not button descriptors — actions are forms with a hidden id. */
  actions?: (row: T) => ReactNode;
  empty: ReactNode;
  /** Offered only at zero rows — the same create trigger the page's header already shows. */
  emptyAction?: ReactNode;
  footer?: ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  empty,
  emptyAction,
  footer,
}: DataTableProps<T>) {
  if (rows.length === 0) return <EmptyState action={emptyAction}>{empty}</EmptyState>;

  const wide = columns.filter((column) => column.emphasis !== 'secondary');

  // `rows` may be a `Counted` (carries `total`) or a plain filtered array with no honest total.
  const total = (rows as Partial<{ total: number }>).total;
  const partial = typeof total === 'number' && total > rows.length;

  return (
    <div className="@container">
      <div className="hidden @min-[38rem]:block">
        <Table>
          <TableHeader>
            <TableRow>
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
                {wide.map((column) => (
                  <ShadcnTableCell
                    key={column.key}
                    className={cx(
                      'py-2 pr-4 align-top',
                      column.numeric && 'text-right tabular-nums',
                    )}
                  >
                    {column.cell(row)}
                  </ShadcnTableCell>
                ))}
                {actions ? (
                  <ShadcnTableCell className="align-top">
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
      className={cx('py-2 pr-4 align-top', numeric && 'text-right tabular-nums', className)}
    />
  );
}
