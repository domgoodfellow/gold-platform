// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceRecordPreview, recordPairs } from '@/features/integrations/sources/record-preview';

afterEach(cleanup);

describe('source record preview', () => {
  it('pairs worksheet headers with values, naming columns with no header', () => {
    expect(recordPairs({ headers: ['id', '', 'name'], values: ['42', 'x', 'Alice', 'extra'] })).toEqual([
      { label: 'id', value: '42' }, { label: 'Column 2', value: 'x' }, { label: 'name', value: 'Alice' }, { label: 'Column 4', value: 'extra' },
    ]);
  });
  it('labels nested metadata, joins arrays, shows missing values as a dash and clips long values', () => {
    const pairs = recordPairs({ mimeType: 'text/csv', owner: { name: 'Sam', email: null }, tags: ['a', 'b'], note: 'x'.repeat(900) });
    expect(pairs.find(pair => pair.label === 'Mime type')?.value).toBe('text/csv');
    expect(pairs.find(pair => pair.label === 'Owner · Name')?.value).toBe('Sam');
    expect(pairs.find(pair => pair.label === 'Owner · Email')?.value).toBe('—');
    expect(pairs.find(pair => pair.label === 'Tags')?.value).toBe('a, b');
    expect(pairs.find(pair => pair.label === 'Note')!.value.length).toBeLessThan(450);
  });
  it('renders name, timestamp, labelled values and an on-demand raw view without altering the metadata', () => {
    const metadata = { headers: ['id', 'name'], values: ['42', 'Alice'] };
    const { container } = render(<SourceRecordPreview record={{ external_id: '42', display_name: 'Row 42', metadata, source_updated_at: '2026-01-02T03:04:05Z' }} />);
    expect(screen.getByText('Row 42')).toBeInTheDocument();
    expect(screen.getByText(/Updated 2026-01-02 03:04 UTC/)).toBeInTheDocument();
    expect(screen.getByText('name').nextElementSibling).toHaveTextContent('Alice');
    expect(screen.getByText('View raw metadata')).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(metadata, null, 2));
    expect(metadata).toEqual({ headers: ['id', 'name'], values: ['42', 'Alice'] });
  });
  it('says so for an empty record and falls back to the key when it has no name', () => {
    render(<SourceRecordPreview record={{ external_id: 'key-1', display_name: null, metadata: {} }} />);
    expect(screen.getByText('key-1')).toBeInTheDocument();
    expect(screen.getByText('This record has no details to show.')).toBeInTheDocument();
  });
});
