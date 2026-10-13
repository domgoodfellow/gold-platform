import { describe, expect, it } from 'vitest';
import { channelDiagnostics } from '@/lib/domain/reception/channel-diagnostics';
import type { PhoneNumber } from '@/lib/domain/reception/numbers';
import type { EmailIdentityView } from '@/lib/domain/email/identities';
const feature = { implementationState: 'available' as const, entitled: true, activation: 'active' as const, readiness: 'ready' as const };
const number: PhoneNumber = { id: 'one', e164: '+14165550100', label: null, lifecycle: 'active', purpose: 'main', voiceInboundEnabled: true, voiceOutboundEnabled: true, smsInboundEnabled: true, smsOutboundEnabled: true, readiness: 'ready', origin: 'provisioned', createdBy: null };
const identity: EmailIdentityView = { id: 'sender', address: 'hello@example.test', displayName: null, canSend: true, canReceive: false, ownership: 'customer_domain', sendingDomainResourceId: 'domain', integrationConnectionId: null, status: 'active', createdAt: '', readiness: { state: 'ready', reason: null } };
const ready = { smsFeature: feature, emailFeature: feature, numbers: [number], identities: [identity], smsProviderConfigured: true, callbackConfigured: true, providerReadiness: 'ready' as const, emailRelayConfigured: true };
describe('channel configuration evidence', () => {
 it('retains a blocker when an unready identity has no detailed reason', () => {
  expect(channelDiagnostics({ ...ready, identities: [{ ...identity, readiness: { state: 'pending', reason: null } }] }).email).toContainEqual(expect.objectContaining({ code: 'email.identity_not_ready' }));
 });
 it('never hides a planned SMS feature behind a provisioned number', () => {
  const result = channelDiagnostics({ ...ready, smsFeature: { ...feature, implementationState: 'planned' } });
  expect(result.sms).toContainEqual(expect.objectContaining({ code: 'feature.unavailable' }));
  expect(result.email).toEqual([]);
 });
 it('distinguishes unentitled, disabled, callback, and provider blockers', () => {
  const result = channelDiagnostics({ ...ready, smsFeature: { ...feature, activation: 'disabled' }, emailFeature: { ...feature, entitled: false }, callbackConfigured: false, smsProviderConfigured: false });
  expect(result.sms.map(item => item.code)).toEqual(['feature.disabled', 'sms.provider_missing', 'sms.callback_missing']);
  expect(result.email.map(item => item.code)).toEqual(['feature.unentitled']);
 });
 it('keeps provisioned voice-only and inactive numbers unavailable to outbound SMS', () => {
  expect(channelDiagnostics({ ...ready, numbers: [{ ...number, smsOutboundEnabled: false }] }).sms).toContainEqual(expect.objectContaining({ code: 'sms.no_outbound_number' }));
  expect(channelDiagnostics({ ...ready, numbers: [{ ...number, lifecycle: 'inactive' }] }).sms).toContainEqual(expect.objectContaining({ code: 'sms.no_active_number' }));
 });
 it('surfaces domain readiness separately from active sender identity and email relay configuration', () => {
  const result = channelDiagnostics({ ...ready, emailRelayConfigured: false, identities: [{ ...identity, readiness: { state: 'pending', reason: 'The sending domain is not verified yet.' } }] });
  expect(result.email.map(item => item.code)).toEqual(['email.relay_missing', 'email.identity_not_ready']);
  expect(result.email[1].message).toBe('The sending domain is not verified yet.');
  expect(channelDiagnostics({ ...ready, identities: [{ ...identity, status: 'disabled' }] }).email).toContainEqual(expect.objectContaining({ code: 'email.no_identity' }));
 });
 it('empty configuration names the missing identities rather than fabricating senders', () => {
  expect(channelDiagnostics({ ...ready, numbers: [], identities: [] })).toMatchObject({ sms: [{ code: 'sms.no_number' }], email: [{ code: 'email.no_identity' }] });
 });
});
