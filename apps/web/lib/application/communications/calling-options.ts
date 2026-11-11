import type { Db } from '@/lib/db/types';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listPhoneNumbers, resolveOutboundNumber } from '@/lib/domain/reception/numbers';
import { communicationsProviderReadiness } from '@/lib/domain/reception/provider-readiness';
import { callingRuntimeConfigured } from './calling-runtime';

/**
 * Why calling cannot start, as one of the distinct readiness facts (`docs/ui-system.md`, Configure
 * and readiness): the viewer's role (`restricted`), something this business must still set up
 * (`not-configured`, with the configuration concern that fixes it), or the deployment or carrier
 * (`unavailable`). They are worded and presented apart, never collapsed into "disabled".
 */
export type CallingBlocker = {
  kind: 'restricted' | 'not-configured' | 'unavailable';
  reason: string;
  /** The registered configuration target that resolves it, when the business itself can. */
  setup: 'phone-numbers' | null;
};

export type CallingOptions = {
  numbers: { id: string; e164: string; label: string | null }[];
  defaultNumber: { id: string; e164: string; label: string | null } | null;
  unavailableReason: string | null;
  blocker: CallingBlocker | null;
};

export async function loadCallingOptions(db: Db, input: { organizationId: string; mayCall: boolean }): Promise<CallingOptions> {
  const unavailable = (kind: CallingBlocker['kind'], reason: string, setup: CallingBlocker['setup'] = null): CallingOptions => ({ numbers: [], defaultNumber: null, unavailableReason: reason, blocker: { kind, reason, setup } });
  if (!input.mayCall) return unavailable('restricted', 'Your role cannot place calls.');
  const states = await organizationResolvedFeatureStates(db, { organizationId: input.organizationId });
  if (!availableFeatureKeys(states).has('outbound_calling')) return unavailable('not-configured', 'Outbound calling is not included for this business.');
  // A calling account that exists and is faulty is said first; one that is absent is said second.
  if (await communicationsProviderReadiness(db, input) !== 'ready') return unavailable('unavailable', 'Calling is temporarily unavailable.');
  if (!await callingRuntimeConfigured(db, { organizationId: input.organizationId, mayCall: true })) return unavailable('unavailable', 'Calling isn’t enabled yet.');
  const [numbers, usual] = await Promise.all([listPhoneNumbers(db, input), resolveOutboundNumber(db, input)]);
  const dialable = numbers.filter(number => number.voiceOutboundEnabled && number.readiness === 'ready' && number.lifecycle === 'active' && (number.origin === 'provisioned' || number.origin === 'external'))
    .map(({ id, e164, label }) => ({ id, e164, label }));
  const defaultNumber = usual ? dialable.find(number => number.id === usual.phoneNumberId) ?? null : null;
  if (!dialable.length && !defaultNumber) return unavailable('not-configured', 'No ready outbound number is assigned. Check number assignments and calling setup.', 'phone-numbers');
  return { numbers: dialable, defaultNumber, unavailableReason: null, blocker: null };
}
