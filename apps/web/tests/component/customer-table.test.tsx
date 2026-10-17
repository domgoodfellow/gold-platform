// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomerTable, optionalColumnChoices } from '@/features/crm/customers/customer-table';
import type { Customer } from '@/lib/domain/customers/customers';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';

/**
 * Shapes the first CSV import actually produced: a business with no email, one whose name is long
 * enough to wrap, a North American number stored in E.164, and custom values for industry and
 * website. Each assertion reads the wide table's own headers and cells, so a column hidden by CSS
 * cannot satisfy it.
 */

const definition = (key: string, label: string, kind: FieldDefinition['kind'] = 'text', options: string[] = []): FieldDefinition => ({
  id: `def-${key}`,
  entityType: 'customer',
  key,
  label,
  kind,
  required: false,
  position: 0,
  options,
  createdAt: '2026-01-01T00:00:00Z',
});

const DEFINITIONS: FieldDefinition[] = [
  definition('industry', 'Industry', 'select', ['Plumbing', 'Electrical']),
  definition('website', 'Website'),
  definition('vat_number', 'VAT number'),
];

const CUSTOMERS: Customer[] = [
  {
    id: 'c-1',
    name: 'Harbour & Hearth Plumbing and Mechanical Contracting Ltd. (Head Office and Dispatch)',
    email: null,
    phone: '+14165550176',
    custom: { industry: 'Plumbing', website: 'https://harbourhearth.example' },
    stageId: null,
    createdAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'c-2',
    name: 'Brightline Electric',
    email: 'office@brightline.example',
    phone: '+16135550199',
    custom: { industry: 'Electrical', vat_number: 'CA123456789' },
    stageId: null,
    createdAt: '2026-02-02T00:00:00Z',
  },
  {
    id: 'c-3',
    name: 'Unlisted Contact',
    email: null,
    phone: null,
    custom: {},
    stageId: null,
    createdAt: '2026-02-03T00:00:00Z',
  },
];

const LOCATIONS = { 'c-2': '210 Queen St, Ottawa, ON' };

function renderTable(optional: string[] = []) {
  return render(
    <CustomerTable
      organizationId="org-1"
      customers={CUSTOMERS}
      definitions={DEFINITIONS}
      locationLabels={LOCATIONS}
      optional={optional}
    />,
  );
}

function wideTable(container: HTMLElement): HTMLElement {
  const table = container.querySelector('table');
  if (!table) throw new Error('expected the wide table to render');
  return table;
}

function headers(container: HTMLElement): string[] {
  return within(wideTable(container)).getAllByRole('columnheader').map((header) => header.textContent ?? '');
}

function rowCells(container: HTMLElement, name: string): string[] {
  const row = within(wideTable(container))
    .getAllByRole('row')
    .find((candidate) => candidate.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return within(row).getAllByRole('cell').map((cell) => cell.textContent ?? '');
}

afterEach(cleanup);

describe('customer directory table', () => {
  it('shows the working columns by default and nothing from the custom-field dump', () => {
    const { container } = renderTable();

    expect(headers(container)).toEqual(['Name', 'Phone', 'Industry', 'Location']);
    expect(screen.queryByText('Details')).toBeNull();
    expect(screen.queryByText('VAT number')).toBeNull();
  });

  it('displays a Canadian number grouped while the dial link keeps the stored value', () => {
    const { container } = renderTable();

    const link = within(wideTable(container)).getByRole('link', { name: '+1 416 555 0176' });
    expect(link.getAttribute('href')).toBe('tel:+14165550176');
    expect(rowCells(container, 'Brightline Electric')).toContain('+1 613 555 0199');
  });

  it('shows a dash for a missing phone, a missing industry and a missing location rather than inventing one', () => {
    const { container } = renderTable();

    const cells = rowCells(container, 'Unlisted Contact');
    expect(cells.filter((text) => text === '—')).toHaveLength(3);
  });

  it('keeps a long business name whole in the wide table', () => {
    const { container } = renderTable();

    expect(within(wideTable(container)).getByText(/Head Office and Dispatch/)).toBeTruthy();
  });

  it('shows the recorded location and the industry from the custom value', () => {
    const { container } = renderTable();

    const cells = rowCells(container, 'Brightline Electric');
    expect(cells).toContain('Electrical');
    expect(cells).toContain('210 Queen St, Ottawa, ON');
  });

  it('adds an optional column only when the view asks for it, with its own value', () => {
    const { container } = renderTable(['custom:website', 'custom:vat_number']);

    expect(headers(container)).toEqual(['Name', 'Phone', 'Industry', 'Location', 'Website', 'VAT number']);
    expect(rowCells(container, 'Harbour')).toContain('https://harbourhearth.example');
    expect(rowCells(container, 'Brightline Electric')).toContain('CA123456789');
  });

  it('shows an email only in the optional email column, and a dash where none is recorded', () => {
    const { container } = renderTable(['email']);

    expect(headers(container)).toContain('Email');
    expect(rowCells(container, 'Brightline Electric')).toContain('office@brightline.example');
    expect(rowCells(container, 'Harbour')).toContain('—');
  });

  it('lists the industry filter options and every optional field except industry', () => {
    const choices = optionalColumnChoices(DEFINITIONS).map((choice) => choice.id);

    expect(choices).toEqual(['email', 'custom:website', 'custom:vat_number']);
  });
});
