// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable, type Column } from '@/components/display/table';

/**
 * Column visibility is explicit. A column is in the wide table unless it says `card-only`, and
 * `emphasis` only chooses the card heading. jsdom does not compute CSS, so both renderings are
 * present at once; the assertions read the `<table>` element itself, which is what the wide layout
 * is, rather than trusting a `hidden` class to decide what is on screen.
 */

type Row = { id: string; name: string; phone: string; detail: string };

const ROWS: Row[] = [{ id: '1', name: 'Harbour & Hearth Plumbing Ltd.', phone: '+1 416 555 0176', detail: 'Ten-year maintenance contract' }];

const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Name', emphasis: 'primary', cell: (row) => row.name },
  { key: 'phone', header: 'Phone', cell: (row) => row.phone },
  { key: 'detail', header: 'Detail', visibility: 'card-only', cell: (row) => row.detail },
];

afterEach(cleanup);

function wideHeaders(container: HTMLElement): string[] {
  const table = container.querySelector('table');
  if (!table) throw new Error('expected the wide table to render');
  return within(table).getAllByRole('columnheader').map((header) => header.textContent ?? '');
}

describe('DataTable column visibility', () => {
  it('keeps table-and-card columns in the wide table', () => {
    const { container } = render(<DataTable rows={ROWS} rowKey={(row) => row.id} empty="None" columns={COLUMNS} />);

    expect(wideHeaders(container)).toEqual(['Name', 'Phone']);
  });

  it('keeps a card-only column out of the wide table but in the card', () => {
    const { container } = render(<DataTable rows={ROWS} rowKey={(row) => row.id} empty="None" columns={COLUMNS} />);

    expect(wideHeaders(container)).not.toContain('Detail');
    const card = container.querySelector('li');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('Ten-year maintenance contract')).toBeTruthy();
  });

  it('renders the primary column as the card heading, not as a labelled row', () => {
    const { container } = render(<DataTable rows={ROWS} rowKey={(row) => row.id} empty="None" columns={COLUMNS} />);

    const card = container.querySelector('li') as HTMLElement;
    const dl = card.querySelector('dl') as HTMLElement;
    expect(within(dl).queryByText('Harbour & Hearth Plumbing Ltd.')).toBeNull();
    expect(within(card).getByText('Harbour & Hearth Plumbing Ltd.')).toBeTruthy();
  });

  it('keeps a card-only column out of the wide table even when it has no emphasis', () => {
    const plain: Column<Row>[] = [
      { key: 'name', header: 'Name', cell: (row) => row.name },
      { key: 'detail', header: 'Detail', visibility: 'card-only', cell: (row) => row.detail },
    ];
    const { container } = render(<DataTable rows={ROWS} rowKey={(row) => row.id} empty="None" columns={plain} />);

    expect(wideHeaders(container)).toEqual(['Name']);
  });
});
