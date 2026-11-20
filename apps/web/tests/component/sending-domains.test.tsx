// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendingDomain } from '@/lib/domain/email/sending-domains';

/**
 * Email sending → Sending domains: what a person sees about each domain and what pressing Check
 * verification tells them. The rule that matters most: a check that went through but found the
 * domain still pending is never presented as success.
 */

const actions = vi.hoisted(() => ({
  checkSendingDomainAction: vi.fn(),
  applySendingDomainDnsAction: vi.fn(),
  requestSendingDomainAction: vi.fn(),
  releaseSendingDomainAction: vi.fn(),
}));
vi.mock('@/app/organizations/[organizationId]/settings/email/actions', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { SendingDomainActions } from '@/features/communications/email/sending-domain-actions';
import { SendingDomains } from '@/features/communications/email/sending-domains';

const DKIM = `p=${'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA'.repeat(9)}`;

const PENDING: SendingDomain = {
  resourceId: 'r-pending',
  domain: 'gildops.com',
  state: 'pending',
  providerDomainId: 'd-1',
  providerStatus: 'pending',
  records: [
    { type: 'TXT', name: 'resend._domainkey.gildops.com', value: DKIM, purpose: 'DKIM', status: 'pending' },
    { type: 'MX', name: 'send.gildops.com', value: 'feedback-smtp.us-east-1.amazonses.com', purpose: 'SPF', status: 'failed', priority: 10 },
    { type: 'TXT', name: 'send.gildops.com', value: 'v=spf1 include:amazonses.com ~all', purpose: 'SPF', status: 'verified' },
  ],
  outstandingRecords: 2,
  errorCode: null,
  errorMessage: null,
  lastVerifiedAt: null,
  checkedAt: '2026-11-20T10:00:00.000Z',
  createdAt: '2026-11-19T10:00:00.000Z',
};

const VERIFIED: SendingDomain = {
  ...PENDING,
  resourceId: 'r-ready',
  domain: 'mail.acme.ca',
  state: 'ready',
  records: PENDING.records.map((record) => ({ ...record, status: 'verified' as const })),
  outstandingRecords: 0,
  lastVerifiedAt: '2026-11-18T10:00:00.000Z',
};

const state = (result: { kind: string; message: string } | null, extra: Record<string, unknown> = {}) => ({
  error: null,
  notice: null,
  done: result?.kind === 'verified',
  ...(result ? { result: { ...result, checkedAt: new Date().toISOString() } } : {}),
  ...extra,
});

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  toast.success.mockReset();
});
afterEach(cleanup);

describe('the sending domains section', () => {
  it('is one section, listing each domain with its status and its one next action', () => {
    render(<SendingDomains organizationId="o" domains={[PENDING, VERIFIED]} automatedZone={() => null} />);

    expect(screen.getAllByRole('heading', { name: 'Sending domains' })).toHaveLength(1);
    expect(screen.queryByText('Your sending domains')).toBeNull();
    const list = screen.getByRole('list', { name: 'Sending domains' });
    const [pending, verified] = within(list).getAllByRole('listitem').filter((item) => item.parentElement === list);
    expect(within(pending).getByText('gildops.com')).toBeTruthy();
    expect(within(pending).getByText('DNS required')).toBeTruthy();
    expect(within(pending).getByText('1 of 3 DNS records not found yet.')).toBeTruthy();
    expect(within(pending).getByText(/Last checked/)).toBeTruthy();
    expect(within(pending).getByRole('button', { name: 'Check verification for gildops.com' })).toBeTruthy();
    expect(within(verified).getByText('Verified')).toBeTruthy();
    expect(within(verified).queryByRole('button', { name: /Check verification/ })).toBeNull();
    expect(within(verified).getByRole('button', { name: 'Remove mail.acme.ca' })).toBeTruthy();
  });

  it('shows DNS records only for a domain that still needs them, under one heading and one instruction', () => {
    render(<SendingDomains organizationId="o" domains={[PENDING, VERIFIED]} automatedZone={() => null} />);

    expect(screen.getAllByRole('heading', { name: 'DNS records' })).toHaveLength(1);
    expect(screen.getAllByText('Add these at your DNS host, then check verification.')).toHaveLength(1);
    const dkim = screen.getAllByRole('textbox', { name: 'TXT record value' }) as HTMLInputElement[];
    expect(dkim.map((field) => field.value)).toContain(DKIM);
  });

  it('keeps adding another domain available once one exists', () => {
    render(<SendingDomains organizationId="o" domains={[PENDING]} automatedZone={() => null} />);

    expect(screen.getByRole('button', { name: 'Add another domain' })).toBeTruthy();
  });

  it('asks for the first domain directly when there is none', () => {
    render(<SendingDomains organizationId="o" domains={[]} automatedZone={() => null} />);

    expect(screen.getByRole('textbox', { name: 'Domain to send from' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'DNS records' })).toBeNull();
  });
});

describe('checking verification', () => {
  const render_ = () => render(<SendingDomainActions organizationId="o" resourceId="r" domain="gildops.com" canStart={false} canApply={false} />);

  it('never shows success when the domain is still pending, and says what is outstanding beside the domain', async () => {
    actions.checkSendingDomainAction.mockResolvedValue(state({ kind: 'pending', message: 'Verification requested. 2 of 3 DNS records not verified yet; DNS changes can take a while to spread.' }));
    render_();
    await userEvent.click(screen.getByRole('button', { name: 'Check verification for gildops.com' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/^Verification requested\. 2 of 3 DNS records not verified yet/);
    expect(status.textContent).toMatch(/Checked /);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('confirms a verified domain with a toast as well as on the domain', async () => {
    actions.checkSendingDomainAction.mockResolvedValue(state({ kind: 'verified', message: 'Verified. You can add sender addresses at this domain.' }));
    render_();
    await userEvent.click(screen.getByRole('button', { name: 'Check verification for gildops.com' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/^Verified\./);
    expect(toast.success).toHaveBeenCalledWith('gildops.com is verified.');
  });

  it.each([
    ['records_missing', '1 of 3 DNS records not found. Publish them at your DNS host, then check again.'],
    ['provider_unavailable', 'Sending from your own domain isn’t available yet. Nothing is wrong with your domain or your DNS.'],
    ['provider_error', 'The provider did not answer. Try again in a few minutes.'],
  ])('shows a %s answer beside the domain without a success toast', async (kind, message) => {
    actions.checkSendingDomainAction.mockResolvedValue(state({ kind, message }));
    render_();
    await userEvent.click(screen.getByRole('button', { name: 'Check verification for gildops.com' }));

    expect((await screen.findByRole('status')).textContent).toContain(message);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps removal secondary and behind a confirmation', async () => {
    render_();
    await userEvent.click(screen.getByRole('button', { name: 'Remove gildops.com' }));

    expect(await screen.findByRole('button', { name: 'Remove domain' })).toBeTruthy();
    expect(actions.releaseSendingDomainAction).not.toHaveBeenCalled();
  });
});
