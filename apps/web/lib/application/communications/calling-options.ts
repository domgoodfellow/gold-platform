import type { Db } from '@/lib/db/types';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listOutboundNumberOptions, listPhoneNumbers, type OutboundNumberSource } from '@/lib/domain/reception/numbers';
import { callingAccountState } from '@/lib/domain/reception/provider-readiness';
import { callingRuntimeConfigured } from './calling-runtime';

/**
 * Why calling cannot start. `kind` is how it is presented (`docs/ui-system.md`, Configure and
 * readiness): the viewer's role (`restricted`), something this business must still set up
 * (`not-configured`), or the calling account, the carrier or the deployment (`unavailable`). They
 * are worded and presented apart, never collapsed into "disabled". `code` is the exact condition,
 * so a fault in the service is never worded as something the business left undone.
 */
export type CallingBlockerCode =
  | 'no-permission'
  | 'not-included'
  | 'no-calling-account'
  | 'calling-account-setting-up'
  | 'calling-account-fault'
  | 'calling-account-suspended'
  | 'service-unavailable'
  | 'no-numbers'
  | 'numbers-not-enabled'
  | 'numbers-not-ready'
  | 'no-eligible-number';

export type CallingBlocker = {
  kind: 'restricted' | 'not-configured' | 'unavailable';
  code: CallingBlockerCode;
  reason: string;
  /** The registered configuration target where it is fixed or its state can be seen, when there is one. */
  setup: 'phone-numbers' | null;
};

/**
 * A number this person may call from, with why. `group` is how it is offered: `assigned` is a
 * number held by this member; `shared` is one the business lets every caller use (its default
 * number or a shared number).
 */
export type OutboundLine = { id: string; e164: string; label: string | null; source: OutboundNumberSource; group: 'assigned' | 'shared' };

export type CallingOptions = {
  /** Every number the server would accept from this person, in the resolver's order. */
  numbers: OutboundLine[];
  /** What a call uses when no number is named: Automatic. */
  defaultNumber: OutboundLine | null;
  unavailableReason: string | null;
  blocker: CallingBlocker | null;
};

/**
 * Where a blocker is fixed, for this viewer: the configuration door it names, only when that door
 * is among the ones the viewer may open. No door, no link.
 */
export function callingSetupDoor(blocker: CallingBlocker | null, doors: readonly { key: string; label: string; href: string }[]): { href: string; label: string } | null {
  if (!blocker?.setup) return null;
  const door = doors.find((candidate) => candidate.key === blocker.setup);
  return door ? { href: door.href, label: door.label } : null;
}

const ACCOUNT_BLOCKER: Record<'absent' | 'provisioning' | 'failed' | 'suspended', [CallingBlockerCode, string]> = {
  absent: ['no-calling-account', 'Calling is not set up for this business yet.'],
  provisioning: ['calling-account-setting-up', 'This business’s calling account is still being set up.'],
  failed: ['calling-account-fault', 'This business’s calling account has a fault, so calls cannot be placed.'],
  suspended: ['calling-account-suspended', 'Calling is suspended for this business.'],
};

/**
 * What this person can call from, or the one exact reason they cannot. Checked in order of who
 * could act on it: the role, the plan, the calling account, the service, then the numbers.
 *
 * The numbers are the database resolver's own candidates (`outbound_number_options`), never a list
 * filtered here, so the Dialer, the pop-out window and a placed call agree on what is allowed.
 */
export async function loadCallingOptions(db: Db, input: { organizationId: string; mayCall: boolean }): Promise<CallingOptions> {
  const blocked = (kind: CallingBlocker['kind'], code: CallingBlockerCode, reason: string, setup: CallingBlocker['setup'] = null): CallingOptions =>
    ({ numbers: [], defaultNumber: null, unavailableReason: reason, blocker: { kind, code, reason, setup } });

  if (!input.mayCall) return blocked('restricted', 'no-permission', 'Your role cannot place calls.');
  const states = await organizationResolvedFeatureStates(db, { organizationId: input.organizationId });
  if (!availableFeatureKeys(states).has('outbound_calling')) return blocked('not-configured', 'not-included', 'Outbound calling is not included for this business.');

  const account = await callingAccountState(db, input);
  if (account !== 'active') return blocked('unavailable', ...ACCOUNT_BLOCKER[account]);
  if (!await callingRuntimeConfigured(db, { organizationId: input.organizationId, mayCall: true })) return blocked('unavailable', 'service-unavailable', 'Calling is temporarily unavailable.');

  const [inventory, options] = await Promise.all([listPhoneNumbers(db, input), listOutboundNumberOptions(db, input)]);
  if (!options.length) {
    if (!inventory.length) return blocked('not-configured', 'no-numbers', 'This business has no phone numbers.', 'phone-numbers');
    const outbound = inventory.filter(number => number.lifecycle === 'active' && number.voiceOutboundEnabled && (number.origin === 'provisioned' || number.origin === 'external'));
    if (!outbound.length) return blocked('not-configured', 'numbers-not-enabled', 'None of this business’s numbers is active and switched on for placing calls.', 'phone-numbers');
    if (!outbound.some(number => number.readiness === 'ready')) return blocked('unavailable', 'numbers-not-ready', 'This business’s outbound numbers are not ready at the carrier yet.', 'phone-numbers');
    return blocked('not-configured', 'no-eligible-number', 'No outbound number is assigned to you or shared in this business.', 'phone-numbers');
  }

  const numbers = options.map(({ phoneNumberId, e164, label, source }): OutboundLine => ({
    id: phoneNumberId, e164, label, source,
    group: source === 'shared' || source === 'organization_default' ? 'shared' : 'assigned',
  }));
  const automatic = options.findIndex(option => option.automatic);
  return { numbers, defaultNumber: numbers[automatic] ?? null, unavailableReason: null, blocker: null };
}
