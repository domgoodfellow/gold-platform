import { listEmailIdentities } from '@/lib/domain/email/identities';
import { channelDiagnostics } from './channel-diagnostics';
import type { Db } from '@/lib/db/types';
import { messagingCallbackBase, messagingProvider } from '@/lib/adapters/messaging';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { emailDeliveryAvailable } from '@/lib/domain/email/messages';
import { listPhoneNumbers } from './numbers';
import { communicationsProviderReadiness } from './provider-readiness';

export async function messagingSenders(db: Db, input: { organizationId: string }) {
  const [states, numbers, identities, readiness, sms] = await Promise.all([
    organizationResolvedFeatureStates(db, input), listPhoneNumbers(db, input),
    listEmailIdentities(db, input), communicationsProviderReadiness(db, input), messagingProvider(),
  ]);
  const features = availableFeatureKeys(states);
  const email = await emailDeliveryAvailable(db);
  const availableIdentities = identities.filter(identity => identity.canSend && identity.readiness.state === 'ready');
  return {
    numbers: sms && messagingCallbackBase() && readiness === 'ready' && features.has('outbound_sms') ? numbers.filter(number => number.smsOutboundEnabled && number.lifecycle === 'active' && number.readiness === 'ready' && (number.origin === 'provisioned' || number.origin === 'external')) : [],
    senders: email && features.has('sending') ? availableIdentities : [],
    diagnostics: channelDiagnostics({ smsFeature: states.find(state => state.featureKey === 'outbound_sms'), emailFeature: states.find(state => state.featureKey === 'sending'), numbers, identities, smsProviderConfigured: !!sms, callbackConfigured: !!messagingCallbackBase(), providerReadiness: readiness, emailRelayConfigured: email }),
  };
}
