import type { Db } from '@/lib/db/types';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listPhoneNumbers, resolveOutboundNumber } from '@/lib/domain/reception/numbers';
import { communicationsProviderReadiness } from '@/lib/domain/reception/provider-readiness';
import { callingRuntimeConfigured } from './calling-runtime';

export type CallingOptions = {
  numbers: { id: string; e164: string; label: string | null }[];
  defaultNumber: { id: string; e164: string; label: string | null } | null;
  unavailableReason: string | null;
};

export async function loadCallingOptions(db: Db, input: { organizationId: string; mayCall: boolean }): Promise<CallingOptions> {
  const unavailable = (unavailableReason: string): CallingOptions => ({ numbers: [], defaultNumber: null, unavailableReason });
  if (!input.mayCall) return unavailable('Your role cannot place calls.');
  const states = await organizationResolvedFeatureStates(db, { organizationId: input.organizationId });
  if (!availableFeatureKeys(states).has('outbound_calling')) return unavailable('Outbound calling is unavailable for this business.');
  if (!callingRuntimeConfigured(true)) return unavailable('Calling setup is incomplete.');
  if (await communicationsProviderReadiness(db, input) !== 'ready') return unavailable('The calling provider is not ready.');
  const [numbers, usual] = await Promise.all([listPhoneNumbers(db, input), resolveOutboundNumber(db, input)]);
  const dialable = numbers.filter(number => number.voiceOutboundEnabled && number.readiness === 'ready' && number.lifecycle === 'active' && (number.origin === 'provisioned' || number.origin === 'external'))
    .map(({ id, e164, label }) => ({ id, e164, label }));
  const defaultNumber = usual ? dialable.find(number => number.id === usual.phoneNumberId) ?? null : null;
  if (!dialable.length && !defaultNumber) return unavailable('No ready outbound number is assigned. Check number assignments and calling setup.');
  return { numbers: dialable, defaultNumber, unavailableReason: null };
}
