import type { Db } from '@/lib/db/types';
import { messagingCallbackBase, messagingProvider } from '@/lib/adapters/messaging';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { emailDeliveryAvailable, listSendableEmailIdentities } from '@/lib/domain/email/messages';
import { listPhoneNumbers } from './numbers';
import { communicationsProviderReadiness } from './provider-readiness';

export async function messagingSenders(db: Db, input: { organizationId: string }) {
  const [states, numbers, identities, readiness, sms] = await Promise.all([
    organizationResolvedFeatureStates(db, input), listPhoneNumbers(db, input),
    listSendableEmailIdentities(db, input), communicationsProviderReadiness(db, input), messagingProvider(),
  ]);
  const features = availableFeatureKeys(states);
  const email = identities.length ? await emailDeliveryAvailable(db) : false;
  return {
    numbers: sms && messagingCallbackBase() && readiness === 'ready' && features.has('outbound_sms') ? numbers.filter(number => number.smsOutboundEnabled && number.lifecycle === 'active' && number.readiness === 'ready' && (number.origin === 'provisioned' || number.origin === 'external')) : [],
    senders: email && features.has('sending') ? identities : [],
  };
}
