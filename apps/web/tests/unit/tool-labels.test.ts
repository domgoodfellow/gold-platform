import { describe, expect, it } from 'vitest';
import { hostOf, outcomeOf, serverFacts } from '@/lib/domain/integrations/tool-labels';

describe('how a recorded execution reads', () => {
  it('says what happened in plain words and never leaks a code', () => {
    expect(outcomeOf({ status: 'succeeded', refusalReason: null, errorClass: null })).toEqual({ label: 'Done', detail: null, tone: 'success' });
    expect(outcomeOf({ status: 'refused', refusalReason: 'grant_revoked', errorClass: null })).toMatchObject({ label: 'Refused', detail: 'Access was withdrawn', tone: 'danger' });
    expect(outcomeOf({ status: 'failed', refusalReason: null, errorClass: 'provider_refused' })).toMatchObject({ label: 'Failed', detail: 'The app refused it' });
    expect(outcomeOf({ status: 'pending_approval', refusalReason: null, errorClass: null }).label).toBe('Waiting for approval');
    expect(outcomeOf({ status: 'expired', refusalReason: null, errorClass: null }).detail).toBe('Nobody decided in time');
  });

  it('shows nothing rather than a raw code for a reason it does not know', () => {
    const unknown = outcomeOf({ status: 'refused', refusalReason: 'a_new_code', errorClass: null });
    expect(unknown.detail).toBeNull();
    expect(JSON.stringify(unknown)).not.toContain('a_new_code');
  });
});

describe('a server is four separate facts', () => {
  it('is connected without being discovered, and healthy only when both are true', () => {
    expect(serverFacts({ connectionStatus: 'active', discoveryStatus: 'never', enabled: true })).toEqual({
      connected: true, discovered: false, switchedOn: true, healthy: false,
    });
    expect(serverFacts({ connectionStatus: 'active', discoveryStatus: 'succeeded', enabled: false })).toEqual({
      connected: true, discovered: true, switchedOn: false, healthy: true,
    });
    expect(serverFacts({ connectionStatus: 'needs_attention', discoveryStatus: 'succeeded', enabled: true }).healthy).toBe(false);
    expect(serverFacts({ connectionStatus: 'disconnected', discoveryStatus: 'succeeded', enabled: true }).connected).toBe(false);
    expect(serverFacts({ connectionStatus: undefined, discoveryStatus: 'never', enabled: true }).connected).toBe(false);
  });

  it('shows only the host of an address', () => {
    expect(hostOf('https://mcp.example.com/v1/mcp?x=1')).toBe('mcp.example.com');
    expect(hostOf('not a url')).toBe('not a url');
  });
});
