import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * A business's numbers, as identities it operates — not as carrier resources.
 *
 * **Two questions, two owners.** Whether the carrier knows a number, and in what state, is provider
 * provisioning (`lib/domain/providers/`). What a business uses a ready number *for*, who dials from
 * it and whether it takes calls or texts is this file, and it is the only thing the Numbers screen
 * lets a tenant change. Nothing here writes where a number came from, which resource stands behind
 * it, or whether it exists.
 */

/**
 * Who this identity belongs to, not who dialled it (D39, restated for the number itself).
 * `provisioned`: GildOps created it at the carrier and holds the provider resource behind it.
 * `external`: a number this business already owned, taken as an outbound caller id where the
 * carrier's own rules permit — GildOps controls no inbound traffic on it. `browser`: an internal
 * calling endpoint, never presented as a public number. `sip`: reserved vocabulary with no writer
 * and no behaviour; nothing in the product offers it.
 */
export type PhoneNumberOrigin = 'provisioned' | 'external' | 'browser' | 'sip';

/** What a number is for, in the few words the platform has to understand. The business's own word is the label. */
export const NUMBER_PURPOSES = ['general', 'main', 'reception', 'sales', 'support'] as const;
export type NumberPurpose = (typeof NUMBER_PURPOSES)[number];

/** Derived on every read from the provider's state; never stored (see `phone_number_readiness`). */
export type NumberReadiness = 'ready' | 'setup_required' | 'degraded' | 'unavailable';

export type PhoneNumber = {
  id: string;
  e164: string;
  label: string | null;
  lifecycle: 'active' | 'inactive' | 'quarantined';
  purpose: NumberPurpose;
  voiceInboundEnabled: boolean;
  voiceOutboundEnabled: boolean;
  smsInboundEnabled: boolean;
  smsOutboundEnabled: boolean;
  readiness: NumberReadiness;
  origin: PhoneNumberOrigin;
  createdBy: string | null;
};

const NUMBER_COLUMNS =
  'id, e164, label, lifecycle, purpose, voice_inbound_enabled, voice_outbound_enabled, sms_inbound_enabled, sms_outbound_enabled, origin, created_by';

type NumberRow = {
  id: string;
  e164: string;
  label: string | null;
  lifecycle: string;
  purpose: string;
  voice_inbound_enabled: boolean;
  voice_outbound_enabled: boolean;
  sms_inbound_enabled: boolean;
  sms_outbound_enabled: boolean;
  origin: string;
  created_by: string | null;
};

function toPhoneNumber(row: NumberRow, readiness: NumberReadiness): PhoneNumber {
  return {
    id: row.id,
    e164: row.e164,
    label: row.label,
    lifecycle: row.lifecycle as PhoneNumber['lifecycle'],
    purpose: row.purpose as NumberPurpose,
    voiceInboundEnabled: row.voice_inbound_enabled,
    voiceOutboundEnabled: row.voice_outbound_enabled,
    smsInboundEnabled: row.sms_inbound_enabled,
    smsOutboundEnabled: row.sms_outbound_enabled,
    readiness,
    origin: row.origin as PhoneNumberOrigin,
    createdBy: row.created_by,
  };
}

async function readinessByNumber(db: Db, organizationId: string): Promise<Map<string, NumberReadiness>> {
  const { data, error } = await db
    .from('phone_number_readiness')
    .select('phone_number_id, readiness')
    .eq('organization_id', organizationId);
  if (error) throw new DomainError(error.message, 'numbers.readiness_failed');
  return new Map((data ?? []).map((row) => [row.phone_number_id as string, row.readiness as NumberReadiness]));
}

export async function listPhoneNumbers(db: Db, input: { organizationId: string }): Promise<PhoneNumber[]> {
  const [{ data, error }, readiness] = await Promise.all([
    db.from('phone_numbers').select(NUMBER_COLUMNS).eq('organization_id', input.organizationId).order('e164'),
    readinessByNumber(db, input.organizationId),
  ]);
  if (error) throw new DomainError(error.message, 'numbers.list_failed');
  return (data ?? []).map((row) => toPhoneNumber(row, readiness.get(row.id) ?? 'unavailable'));
}

/** One number, or null if it does not exist in this organization — the honest absence, not a thrown error. */
export async function getPhoneNumber(
  db: Db,
  input: { organizationId: string; phoneNumberId: string },
): Promise<PhoneNumber | null> {
  const [{ data, error }, readiness] = await Promise.all([
    db
      .from('phone_numbers')
      .select(NUMBER_COLUMNS)
      .eq('organization_id', input.organizationId)
      .eq('id', input.phoneNumberId)
      .maybeSingle(),
    readinessByNumber(db, input.organizationId),
  ]);
  if (error) throw new DomainError(error.message, 'numbers.read_failed');
  return data ? toPhoneNumber(data, readiness.get(data.id) ?? 'unavailable') : null;
}

/**
 * What a business says about how it uses a number. The label is its own word; the purpose is one of
 * a few; each capability is a separate yes or no for each channel. A number the business does not
 * hold at the carrier cannot be told to take inbound traffic, and the database says so.
 */
export async function configurePhoneNumber(
  db: Db,
  input: {
    organizationId: string;
    phoneNumberId: string;
    label: string;
    purpose: NumberPurpose;
    voiceInbound: boolean;
    voiceOutbound: boolean;
    smsInbound: boolean;
    smsOutbound: boolean;
  },
): Promise<void> {
  if (!NUMBER_PURPOSES.includes(input.purpose)) {
    throw new DomainError('That is not something a number can be used for.', 'numbers.purpose_invalid');
  }
  const { error } = await db.rpc('configure_phone_number', {
    p_organization_id: input.organizationId,
    p_phone_number_id: input.phoneNumberId,
    p_label: input.label,
    p_purpose: input.purpose,
    p_voice_inbound: input.voiceInbound,
    p_voice_outbound: input.voiceOutbound,
    p_sms_inbound: input.smsInbound,
    p_sms_outbound: input.smsOutbound,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Your role cannot change how this number is used.' : error.message,
      'numbers.configure_failed',
    );
  }
}

export async function assignPhoneNumber(
  db: Db,
  input: { organizationId: string; phoneNumberId: string; memberId?: string; resourceId?: string; isDefault?: boolean },
): Promise<string> {
  const { data, error } = await db.rpc('assign_phone_number', {
    p_organization_id: input.organizationId,
    p_phone_number_id: input.phoneNumberId,
    p_member_id: input.memberId,
    p_resource_id: input.resourceId,
    p_default: input.isDefault ?? false,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Your role cannot assign numbers.' : error.message,
      'numbers.assign_failed',
    );
  }
  return data as string;
}

export async function releasePhoneNumberAssignment(
  db: Db,
  input: { organizationId: string; assignmentId: string },
): Promise<void> {
  const { error } = await db.rpc('release_phone_number_assignment', {
    p_organization_id: input.organizationId,
    p_assignment_id: input.assignmentId,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Your role cannot release numbers.' : error.message,
      'numbers.release_failed',
    );
  }
}

/** Where a resolved number came from, in the order the resolver prefers them. */
export type OutboundNumberSource = 'preference' | 'member_default' | 'member' | 'organization_default';

export type OutboundNumber = { phoneNumberId: string; e164: string; source: OutboundNumberSource };

/**
 * The number this person dials from: their preference, then their default, then the business's. The
 * only answer to the question — the New call screen, the dialler and the number page all ask the
 * database function and none re-derives it. Naming a number asks whether this person may use that
 * one; it never widens what they may use. Null when nothing usable is configured, which is an
 * ordinary state and not a fault.
 */
export async function resolveOutboundNumber(
  db: Db,
  input: { organizationId: string; phoneNumberId?: string | null },
): Promise<OutboundNumber | null> {
  const { data, error } = await db.rpc('resolve_outbound_number', {
    p_organization_id: input.organizationId,
    p_phone_number_id: input.phoneNumberId ?? undefined,
  });
  if (error) throw new DomainError(error.message, 'numbers.resolve_failed');
  const row = (data ?? [])[0];
  return row ? { phoneNumberId: row.phone_number_id, e164: row.e164, source: row.source as OutboundNumberSource } : null;
}

export type PhoneNumberAssignment = {
  id: string;
  phoneNumberId: string;
  memberId: string | null;
  resourceId: string | null;
  isDefault: boolean;
};

/** Active assignments only — a released one is history, not a current fact about who dials from where. */
export async function listPhoneNumberAssignments(
  db: Db,
  input: { organizationId: string },
): Promise<PhoneNumberAssignment[]> {
  const { data, error } = await db
    .from('phone_number_assignments')
    .select('id, phone_number_id, member_id, resource_id, is_default')
    .eq('organization_id', input.organizationId)
    .is('released_at', null);
  if (error) throw new DomainError(error.message, 'numbers.assignments_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    phoneNumberId: row.phone_number_id,
    memberId: row.member_id,
    resourceId: row.resource_id,
    isDefault: row.is_default,
  }));
}

/** Make one of the numbers assigned to me the one I dial from. The database checks it is mine to use. */
export async function setOutboundPreference(
  db: Db,
  input: { organizationId: string; phoneNumberId: string },
): Promise<void> {
  const { error } = await db.rpc('set_user_phone_number_preference', {
    p_organization_id: input.organizationId,
    p_phone_number_id: input.phoneNumberId,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'That number is not one of yours to dial from.' : error.message,
      'numbers.preference_failed',
    );
  }
}
