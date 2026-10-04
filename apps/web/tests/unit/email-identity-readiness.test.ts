import { describe, expect, it } from 'vitest';
import { emailProvider } from '@/lib/adapters/tenant-email';
import { emailIdentityReadiness } from '@/lib/domain/email/identities';

const identity = { status: 'active' as const, canSend: true };
const none = { sendingDomainStatus: null, connectionStatus: null };

/**
 * Whether an address may be used is a reading of what backs it, never a flag stored beside it —
 * so these are the only facts the answer depends on.
 */
describe('email identity readiness', () => {
  it('follows the sending domain beneath a customer-domain address, and nothing else', () => {
    const customer = { ...identity, ownership: 'customer_domain' as const };
    expect(emailIdentityReadiness(customer, { ...none, sendingDomainStatus: 'active' }).state).toBe('ready');
    expect(emailIdentityReadiness(customer, { ...none, sendingDomainStatus: 'pending' }).state).toBe('pending');
    expect(emailIdentityReadiness(customer, { ...none, sendingDomainStatus: 'failed' }).state).toBe('unavailable');
    expect(emailIdentityReadiness(customer, { ...none, sendingDomainStatus: 'disabled' }).state).toBe('unavailable');
    expect(emailIdentityReadiness(customer, none).state).toBe('unavailable');
  });

  it('follows the connection behind a mailbox', () => {
    const mailbox = { ...identity, ownership: 'connected_mailbox' as const };
    expect(emailIdentityReadiness(mailbox, { ...none, connectionStatus: 'active' }).state).toBe('ready');
    expect(emailIdentityReadiness(mailbox, { ...none, connectionStatus: 'connecting' }).state).toBe('pending');
    expect(emailIdentityReadiness(mailbox, { ...none, connectionStatus: 'needs_attention' }).state).toBe('unavailable');
  });

  it('never claims a managed address is ready while no managed domain exists', () => {
    expect(emailIdentityReadiness({ ...identity, ownership: 'gildops_managed' }, none).state).toBe('unavailable');
  });

  it('is unavailable whenever the address is switched off, whatever backs it', () => {
    const off = { status: 'disabled' as const, canSend: true, ownership: 'customer_domain' as const };
    expect(emailIdentityReadiness(off, { ...none, sendingDomainStatus: 'active' }).state).toBe('unavailable');
  });
});

describe('the tenant email provider seam', () => {
  it('has no implementation on a deployment with no API, and says so rather than pretending to send', async () => {
    delete process.env.GOLD_API_URL;
    expect(await emailProvider({ token: 'a-token' })).toBeNull();
  });
});
