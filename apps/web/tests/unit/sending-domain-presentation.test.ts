import { describe, expect, it } from 'vitest';
import {
  domainCheckFailure,
  domainCheckResult,
  emailSetupStep,
  MANAGED_SENDING,
  PROVIDER_UNAVAILABLE_MESSAGE,
  SENDING_DOMAIN_BADGE,
  sendingDomainPresentation,
  sendingDomainSentence,
  type SendingDomainPresentation,
} from '@/lib/domain/email/presentation';

/**
 * The eight states a sending domain reads as, and what each one tells somebody to do next.
 *
 * The classification is where this screen is most likely to go quietly wrong: every state but
 * `ready` is some flavour of *not finished*, and a screen that collapsed them would tell a
 * business to go and edit DNS when the real problem is that GildOps has no provider account, or
 * tell it to wait when the provider has already refused the name.
 */

const PENDING = {
  state: 'pending' as const,
  errorCode: null,
  providerDomainId: 'd-1',
  outstandingRecords: 2,
  automated: false,
};

describe('how a sending domain reads', () => {
  it('is ready only when the provider says so', () => {
    expect(sendingDomainPresentation({ ...PENDING, state: 'ready', outstandingRecords: 0 })).toBe('ready');
    // Every record published and the provider still checking is not ready.
    expect(sendingDomainPresentation({ ...PENDING, outstandingRecords: 0 })).toBe('checking');
  });

  it('separates automatic from manual DNS by whether this business’s own zone can answer', () => {
    expect(sendingDomainPresentation({ ...PENDING, automated: true })).toBe('automatic_dns');
    expect(sendingDomainPresentation({ ...PENDING, automated: false })).toBe('manual_dns');
  });

  it('calls a domain the provider has never been asked about not started, never waiting on DNS', () => {
    expect(sendingDomainPresentation({ ...PENDING, providerDomainId: null, outstandingRecords: 0 })).toBe('not_created');
  });

  it('never reports GildOps having no provider account as a problem with the domain', () => {
    const unavailable = { ...PENDING, errorCode: 'provider_unavailable' };
    expect(sendingDomainPresentation(unavailable)).toBe('provider_unavailable');
    // Even once the attempt itself has failed, the account is still the thing to say.
    expect(sendingDomainPresentation({ ...unavailable, state: 'failed' })).toBe('provider_unavailable');
    expect(sendingDomainSentence('provider_unavailable', { errorMessage: null, outstandingRecords: 0, zoneName: null, totalRecords: 3, missingRecords: 0 })).toBe(
      PROVIDER_UNAVAILABLE_MESSAGE,
    );
  });

  it('tells a refused name apart from a refused attempt', () => {
    // The provider will not take this name: no retry changes it.
    expect(sendingDomainPresentation({ ...PENDING, state: 'failed' })).toBe('failed');
    // The last attempt did not get an answer: the domain is where it was.
    expect(sendingDomainPresentation({ ...PENDING, errorCode: 'provider_refused' })).toBe('provider_error');
  });

  it('gives every state a badge and a sentence, so none can render blank', () => {
    const states: SendingDomainPresentation[] = [
      'ready',
      'automatic_dns',
      'manual_dns',
      'checking',
      'not_created',
      'provider_unavailable',
      'provider_error',
      'failed',
    ];
    for (const state of states) {
      expect(SENDING_DOMAIN_BADGE[state].label, state).toBeTruthy();
      expect(sendingDomainSentence(state, { errorMessage: null, outstandingRecords: 1, zoneName: 'acme.ca', totalRecords: 3, missingRecords: 0 }), state).toBeTruthy();
    }
  });

  it('counts records in the sentence rather than asserting how many there should be', () => {
    const one = sendingDomainSentence('manual_dns', { errorMessage: null, outstandingRecords: 1, zoneName: null, totalRecords: 3, missingRecords: 0 });
    const all = sendingDomainSentence('manual_dns', { errorMessage: null, outstandingRecords: 3, zoneName: null, totalRecords: 3, missingRecords: 0 });
    expect(one).toBe('1 of 3 DNS records not verified yet.');
    expect(all).toBe('3 of 3 DNS records not verified yet.');
  });

  it('says records were not found when the provider looked and did not find them', () => {
    expect(sendingDomainSentence('manual_dns', { errorMessage: null, outstandingRecords: 3, zoneName: null, totalRecords: 3, missingRecords: 2 }))
      .toBe('2 of 3 DNS records not found yet.');
  });

  it('names the connected zone when there is one to name, and says nothing about one when there is not', () => {
    expect(sendingDomainSentence('automatic_dns', { errorMessage: null, outstandingRecords: 2, zoneName: 'acme.ca', totalRecords: 3, missingRecords: 0 })).toContain('acme.ca');
    expect(sendingDomainSentence('automatic_dns', { errorMessage: null, outstandingRecords: 2, zoneName: null, totalRecords: 3, missingRecords: 0 })).not.toContain('connected');
  });

  it('carries the provider’s own words for a failure rather than inventing a reason', () => {
    expect(sendingDomainSentence('provider_error', { errorMessage: 'the provider timed out', outstandingRecords: 0, zoneName: null, totalRecords: 3, missingRecords: 0 })).toBe(
      'the provider timed out',
    );
  });
});

describe('GildOps-managed sending', () => {
  it('says it is not available rather than implying the invitation sender doubles as one', () => {
    // Work order 1, section 22: a tenant-safe managed sender does not exist yet, and a page that
    // claimed otherwise would be promising a business it can send before it can.
    expect(MANAGED_SENDING.available).toBe(false);
    expect(MANAGED_SENDING.state).toBe('Not available yet');
    expect(MANAGED_SENDING.detail).not.toMatch(/@/);
  });
});

describe('what pressing Check verification found', () => {
  const NOW = '2026-11-20T12:00:00.000Z';
  const records = (...statuses: ('pending' | 'verified' | 'failed')[]) => statuses.map((status) => ({ status }));

  it('reports verified only when the provider says the domain is ready', () => {
    expect(domainCheckResult({ state: 'ready', records: records('verified', 'verified') }, NOW)).toMatchObject({ kind: 'verified', checkedAt: NOW });
  });

  it('never reads a pending answer as success: it says verification was requested and counts what is outstanding', () => {
    const result = domainCheckResult({ state: 'pending', records: records('verified', 'pending', 'pending') }, NOW);
    expect(result.kind).toBe('pending');
    expect(result.message).toBe('Verification requested. 2 of 3 DNS records not verified yet; DNS changes can take a while to spread.');
    expect(result.message).not.toMatch(/^Verified|Checked/);
  });

  it('says which records were not found, as a distinct result from pending', () => {
    expect(domainCheckResult({ state: 'pending', records: records('failed', 'pending', 'verified') }, NOW)).toMatchObject({
      kind: 'records_missing',
      message: '1 of 3 DNS records not found. Publish them at your DNS host, then check again.',
    });
  });

  it('says the provider is still confirming when every record is published but the domain is not yet ready', () => {
    expect(domainCheckResult({ state: 'pending', records: records('verified') }, NOW).kind).toBe('pending');
  });

  it('keeps a rejected domain, an unavailable provider and a provider error apart', () => {
    expect(domainCheckResult({ state: 'failed', records: [] }, NOW).kind).toBe('rejected');
    expect(domainCheckFailure('provider_unavailable', PROVIDER_UNAVAILABLE_MESSAGE, NOW)).toEqual({ kind: 'provider_unavailable', message: PROVIDER_UNAVAILABLE_MESSAGE, checkedAt: NOW });
    expect(domainCheckFailure('provider_error', 'The provider timed out.', NOW).kind).toBe('provider_error');
  });
});

describe('where a business stands in setting up email', () => {
  const pending = { state: 'pending' as const };
  const ready = { state: 'ready' as const };

  it('follows the order setup must happen in', () => {
    expect(emailSetupStep({ sendingState: 'missing', domains: [], readySenders: 0, testsSent: 0 })).toBe('add_domain');
    expect(emailSetupStep({ sendingState: 'missing', domains: [pending], readySenders: 0, testsSent: 0 })).toBe('verify_domain');
    expect(emailSetupStep({ sendingState: 'missing', domains: [pending, ready], readySenders: 0, testsSent: 0 })).toBe('add_sender');
    expect(emailSetupStep({ sendingState: 'missing', domains: [ready], readySenders: 1, testsSent: 0 })).toBe('choose_default');
    expect(emailSetupStep({ sendingState: 'ready', domains: [ready], readySenders: 1, testsSent: 0 })).toBe('send_test');
    expect(emailSetupStep({ sendingState: 'ready', domains: [ready], readySenders: 1, testsSent: 2 })).toBe('ready');
  });

  it('never moves on to senders while no domain is verified', () => {
    expect(emailSetupStep({ sendingState: 'missing', domains: [pending, pending], readySenders: 0, testsSent: 0 })).toBe('verify_domain');
  });

  it('puts a paused or unready default ahead of everything else', () => {
    expect(emailSetupStep({ sendingState: 'unavailable', domains: [ready], readySenders: 1, testsSent: 1 })).toBe('unavailable');
    expect(emailSetupStep({ sendingState: 'not_ready', domains: [ready], readySenders: 0, testsSent: 0 })).toBe('default_not_ready');
  });
});
