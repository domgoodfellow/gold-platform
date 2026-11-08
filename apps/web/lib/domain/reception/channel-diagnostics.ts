import type { PhoneNumber } from './numbers';
import type { EmailIdentityView } from '@/lib/domain/email/identities';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import type { CommunicationsReadiness } from './provider-readiness';
export type ChannelBlocker = { code: string; message: string; target?: 'phone-numbers' | 'email' | 'features' };
export type ChannelDiagnostics = { sms: ChannelBlocker[]; email: ChannelBlocker[] };
type Feature = Pick<ResolvedFeatureState, 'implementationState' | 'entitled' | 'activation' | 'readiness'>;
function featureBlocker(feature: Feature | undefined, label: string): ChannelBlocker[] {
 if (!feature || feature.implementationState !== 'available') return [{ code: 'feature.unavailable', message: `${label} isn’t available yet.`, target: 'features' }];
 if (!feature.entitled) return [{ code: 'feature.unentitled', message: `${label} isn’t included in your plan.`, target: 'features' }];
 if (feature.activation === 'disabled') return [{ code: 'feature.disabled', message: `${label} is switched off for this organization.`, target: 'features' }];
 if (feature.readiness !== 'ready') return [{ code: 'feature.setup_required', message: `${label} feature setup is incomplete.`, target: 'features' }];
 return [];
}
/** Uses the same sender candidates and provider facts as the composer; no delivery claim or secrets. */
export function channelDiagnostics(input: { smsFeature?: Feature; emailFeature?: Feature; numbers: PhoneNumber[]; identities: EmailIdentityView[]; smsProviderConfigured: boolean; callbackConfigured: boolean; providerReadiness: CommunicationsReadiness; emailRelayConfigured: boolean }): ChannelDiagnostics {
 const sms = featureBlocker(input.smsFeature, 'Outbound SMS');
 const email = featureBlocker(input.emailFeature, 'Email sending');
 if (!input.smsProviderConfigured) sms.push({ code: 'sms.provider_missing', message: 'Texting isn’t available yet. GildOps has to finish setting it up.' });
 if (!input.callbackConfigured) sms.push({ code: 'sms.callback_missing', message: 'The messaging callback URL is missing. Delivery-status events cannot be received.' });
 if (input.providerReadiness !== 'ready') sms.push({ code: 'sms.binding_not_ready', message: `The organization's communications connection is ${input.providerReadiness}.` });
 const active = input.numbers.filter(number => number.lifecycle === 'active');
 const textable = active.filter(number => number.smsOutboundEnabled && ['provisioned', 'external'].includes(number.origin));
 if (!input.numbers.length) sms.push({ code: 'sms.no_number', message: 'No organization phone number is available.', target: 'phone-numbers' });
 else if (!active.length) sms.push({ code: 'sms.no_active_number', message: 'No organization phone number is active.', target: 'phone-numbers' });
 else if (!textable.length) sms.push({ code: 'sms.no_outbound_number', message: 'No active number supports outbound SMS.', target: 'phone-numbers' });
 else if (!textable.some(number => number.readiness === 'ready')) sms.push({ code: 'sms.number_not_ready', message: 'Your texting number isn’t ready yet.', target: 'phone-numbers' });
 if (!input.emailRelayConfigured) email.push({ code: 'email.relay_missing', message: 'Sending email isn’t available yet.' });
 const senders = input.identities.filter(identity => identity.canSend && identity.status === 'active');
 if (!senders.length) email.push({ code: 'email.no_identity', message: 'No email address to send from yet.', target: 'email' });
 else if (!senders.some(identity => identity.readiness.state === 'ready')) {
  const reasons = [...new Set(senders.map(identity => identity.readiness.reason).filter(Boolean))];
  if (!reasons.length) reasons.push('The email sender identity is not ready.');
  for (const reason of reasons) email.push({ code: 'email.identity_not_ready', message: reason!, target: 'email' });
 }
 return { sms, email };
}
