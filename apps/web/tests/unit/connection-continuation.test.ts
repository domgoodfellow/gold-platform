import { describe, expect, it } from 'vitest';
import { connectionContinuation, contactImportContinuation } from '@/lib/route/connection-continuation';

const org = '5c29c970-7ce4-4b7b-8b2a-1c2a088bc150';
describe('OAuth contact import continuation', () => {
  it('returns only the fixed Contacts flow for the browser nonce and verified organization', () => {
    const cookie = contactImportContinuation(org, 'browser-nonce');
    expect(connectionContinuation(cookie, 'browser-nonce', org)).toBe(`/organizations/${org}/crm/contacts?import=1`);
    expect(connectionContinuation(cookie, 'another-nonce', org)).toBeNull();
    expect(connectionContinuation(cookie, 'browser-nonce', '2148a739-89b6-4611-a178-6d0ca05b5248')).toBeNull();
    expect(connectionContinuation(cookie, '', org)).toBeNull();
  });
  it('cannot turn arbitrary cookie destinations, unknown intents or malformed values into a redirect', () => {
    for (const cookie of [undefined, '{', 'null', '[]', 'x'.repeat(1001), JSON.stringify({ intent: 'https://attacker.test', organizationId: org, nonce: 'nonce' }), JSON.stringify({ returnTo: '//attacker.test', organizationId: org, nonce: 'nonce' })]) {
      expect(connectionContinuation(cookie, 'nonce', org)).toBeNull();
    }
    expect(connectionContinuation(contactImportContinuation('//attacker.test', 'nonce'), 'nonce', '//attacker.test')).toBeNull();
  });
});
