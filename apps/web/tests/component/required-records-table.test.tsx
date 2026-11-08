// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RequiredRecordsTable } from '@/features/communications/email/required-records-table';
import type { RequiredDnsRecord } from '@/lib/domain/email/sending-domains';

/**
 * The records a person has to reproduce exactly at their DNS host.
 *
 * What is worth proving here is what a person could get wrong by reading the screen: that a
 * value is shown whole rather than truncated into something that would silently fail to verify,
 * that MX's preference is visible, and that a record the provider has already seen is not asking
 * to be published again. The copyable value lives in a read-only input, so its full text is the
 * element's value rather than its text content — which is also why a 400-character DKIM key
 * cannot be clipped by the cell it sits in.
 */

// A real 2048-bit DKIM public key is a little over 400 characters. This is the length that would
// be ruined by any truncation an ellipsis could hide.
const DKIM_VALUE = `p=${'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA'.repeat(9)}`;

const RECORDS: RequiredDnsRecord[] = [
  { type: 'MX', name: 'send.acme.ca', value: 'feedback-smtp.us-east-1.amazonses.com', purpose: 'SPF', status: 'verified', priority: 10 },
  { type: 'TXT', name: 'send.acme.ca', value: 'v=spf1 include:amazonses.com ~all', purpose: 'SPF', status: 'pending' },
  { type: 'TXT', name: 'resend._domainkey.acme.ca', value: DKIM_VALUE, purpose: 'DKIM', status: 'pending' },
];

afterEach(cleanup);

describe('the records a sending domain still needs', () => {
  it('shows every value whole, so a long DKIM key can be copied exactly', () => {
    render(<RequiredRecordsTable records={RECORDS} />);

    // The narrow rendering repeats each row, so there is one input per layout.
    const fields = screen.getAllByLabelText('TXT record value') as HTMLInputElement[];
    expect(fields.some((field) => field.value === DKIM_VALUE)).toBe(true);
    expect(fields.every((field) => !field.value.includes('…'))).toBe(true);
  });

  it('shows the preference on the MX record, and nothing where a type has none', () => {
    // Priority is a `card-only` column, so `DataTable` keeps it out of the wide table and shows it
    // only in the narrow card rendering. jsdom renders both layouts and does not compute CSS, so
    // this looks for the value in either rather than asserting which one is visible.
    render(<RequiredRecordsTable records={RECORDS} />);

    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('—').length).toBeGreaterThan(0);
  });

  it('says which records the provider has already seen, so the count on the page is honest', () => {
    render(<RequiredRecordsTable records={RECORDS} />);

    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Waiting').length).toBeGreaterThan(0);
  });

  it('names what each record is for, in the provider’s own word', () => {
    render(<RequiredRecordsTable records={RECORDS} />);

    expect(screen.getAllByText('DKIM').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SPF').length).toBeGreaterThan(0);
  });

  it('says the host’s own default for TTL rather than inventing a number', () => {
    render(<RequiredRecordsTable records={RECORDS} />);

    expect(screen.getAllByText(/Your host’s default/).length).toBeGreaterThan(0);
  });

  it('says nothing is required rather than drawing an empty table', () => {
    render(<RequiredRecordsTable records={[]} />);

    expect(screen.getByText('No records are needed yet.')).toBeTruthy();
  });
});
