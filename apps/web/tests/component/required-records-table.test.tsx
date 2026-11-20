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
 * cannot be clipped by the row it sits in.
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

    const fields = screen.getAllByLabelText('TXT record value') as HTMLInputElement[];
    expect(fields.map((field) => field.value)).toContain(DKIM_VALUE);
    expect(fields.every((field) => !field.value.includes('…'))).toBe(true);
  });

  it('gives each record its own copy control for host and value, named for the record', () => {
    render(<RequiredRecordsTable records={RECORDS} />);

    expect(screen.getAllByRole('textbox', { name: /record host$/ })).toHaveLength(3);
    expect(screen.getAllByRole('textbox', { name: /record value$/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^Copy/ }).length).toBe(6);
  });

  it('shows the preference on the MX record only', () => {
    render(<RequiredRecordsTable records={RECORDS} />);

    expect(screen.getAllByText('Priority')).toHaveLength(1);
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('says which records the provider has verified, not found or not yet looked at', () => {
    render(<RequiredRecordsTable records={[...RECORDS, { ...RECORDS[1], name: 'missing.acme.ca', status: 'failed' }]} />);

    expect(screen.getAllByText('Verified')).toHaveLength(1);
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(screen.getAllByText('Not found')).toHaveLength(1);
  });

  it('names what each record is for, in the provider’s own word, beside its type', () => {
    render(<RequiredRecordsTable records={RECORDS} />);

    expect(screen.getByText('DKIM')).toBeTruthy();
    expect(screen.getAllByText('SPF')).toHaveLength(2);
    expect(screen.getAllByText('TXT')).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'DNS records' })).toBeTruthy();
  });

  it('says nothing is required rather than drawing an empty list', () => {
    render(<RequiredRecordsTable records={[]} />);

    expect(screen.getByText('No records are needed yet.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
