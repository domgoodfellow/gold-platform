import { describe, expect, it } from 'vitest';
import {
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
    expect(sendingDomainSentence('provider_unavailable', { errorMessage: null, outstandingRecords: 0, zoneName: null })).toBe(
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
      expect(sendingDomainSentence(state, { errorMessage: null, outstandingRecords: 1, zoneName: 'acme.ca' }), state).toBeTruthy();
    }
  });

  it('counts records in the sentence rather than asserting how many there should be', () => {
    const one = sendingDomainSentence('manual_dns', { errorMessage: null, outstandingRecords: 1, zoneName: null });
    const three = sendingDomainSentence('manual_dns', { errorMessage: null, outstandingRecords: 3, zoneName: null });
    expect(one).toContain('the 1 record below');
    expect(three).toContain('the 3 records below');
  });

  it('names the connected zone when there is one to name, and says nothing about one when there is not', () => {
    expect(sendingDomainSentence('automatic_dns', { errorMessage: null, outstandingRecords: 2, zoneName: 'acme.ca' })).toContain('acme.ca');
    expect(sendingDomainSentence('automatic_dns', { errorMessage: null, outstandingRecords: 2, zoneName: null })).not.toContain('connected');
  });

  it('carries the provider’s own words for a failure rather than inventing a reason', () => {
    expect(sendingDomainSentence('provider_error', { errorMessage: 'the provider timed out', outstandingRecords: 0, zoneName: null })).toBe(
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
