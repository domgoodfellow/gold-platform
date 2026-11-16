'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requireAccessToken } from '@/lib/api/client';
import { wrapUpCall } from '@/lib/api/voice';
import { createCallOutcome } from '@/lib/domain/reception/outcomes';
import { linkCallCustomer, recordCall } from '@/lib/domain/reception/calls';
import { setCallingNumber } from '@/lib/domain/reception/telephony';
import { requireOrganization } from '@/lib/route/organization';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import { callContact, callTiming, dialerContactCandidates, getCall, listCallPage, type CallContact } from '@/lib/domain/reception/calls';
import { recentCallRows, type RecentCallRow } from '@/features/communications/voice/format';
import { listTasks } from '@/lib/domain/tasks/tasks';
import { listCallListEntries, type CallListEntry } from '@/lib/domain/tasks/call-list';

export async function matchDialerContact(organizationId: string, number: string): Promise<{ state: 'matched'; contact: CallContact } | { state: 'none' | 'ambiguous' | 'unavailable' }> {
  try {
    const { db } = await requireOperatingArea(organizationId, 'calls');
    const matches = await dialerContactCandidates(db, { organizationId, number });
    return matches.length === 1 ? { state: 'matched', contact: matches[0] } : { state: matches.length ? 'ambiguous' : 'none' };
  } catch (error) { if (error instanceof DomainError) return { state: 'unavailable' }; throw error; }
}

/**
 * What the Dialer needs after a call: its recorded status, any outcome already given, and its
 * time in two parts as the carrier's events recorded them (see `callTiming`).
 */
export type EndedCallRecord = { id: string; status: string; note: string; outcome: { id: string; name: string; reached: boolean } | null; ringSeconds: number | null; talkSeconds: number | null };

/** Reads one call of this business as the viewer; null when it is not theirs to see or cannot be read. */
export async function endedCallRecord(organizationId: string, callId: string): Promise<EndedCallRecord | null> {
  try {
    const { db } = await requireOperatingArea(organizationId, 'calls');
    const call = await getCall(db, { organizationId, callId });
    return call ? { id: call.id, status: call.status, note: call.note, outcome: call.outcome, ...callTiming(call) } : null;
  } catch (error) { if (error instanceof DomainError) return null; throw error; }
}

/** How many of a call's contact's recent calls the Dialer shows beside a call. */
const CALL_CONTEXT_RECENT = 3;

/** Who a call is with, and their recent calls. `contact` is null for a call linked to nobody. */
export type CallContactContext = {
  callId: string;
  contact: CallContact | null;
  recentCalls: RecentCallRow[];
  /** The contact's open Call task, when they have one: a contact has at most one. */
  task?: CallListEntry | null;
};

/**
 * The contact a call is linked to, read from the call itself as the viewer. It does not depend on
 * the call list page the Dialer happens to have loaded, and it never matches by phone number: a
 * call linked to nobody answers nobody. Null when the call cannot be read at all.
 */
export async function callContactContext(organizationId: string, callId: string): Promise<CallContactContext | null> {
  try {
    const { db, organization } = await requireOperatingArea(organizationId, 'calls');
    const contact = await callContact(db, { organizationId, callId });
    if (!contact) return { callId, contact: null, recentCalls: [], task: null };
    const [recent, open] = await Promise.all([
      listCallPage(db, { organizationId, filter: { customerId: contact.id }, limit: CALL_CONTEXT_RECENT }),
      // Their open Call task is found by the contact (there is at most one), not by what is highlighted.
      listTasks(db, { organizationId, customerId: contact.id, status: 'open', kind: 'call', limit: 1 }),
    ]);
    const [task] = open[0] ? await listCallListEntries(db, { organizationId, taskIds: [open[0].id], limit: 1 }) : [];
    return { callId, contact, recentCalls: recentCallRows(recent.items, organization.timezone), task: task ?? null };
  } catch (error) { if (error instanceof DomainError) return null; throw error; }
}

/**
 * The Voice module's writes.
 *
 * **Stage actions moved to `customers/pipeline/actions.ts`.** Naming and moving a pipeline stage
 * are CRM/Sales's own configuration and command, and stayed bundled here only because the
 * `reception` module's history bundled the two Products' screens together — see the Pipeline
 * page's own comment.
 */

export type FormState = { error: string | null };

/** One shape for every action here, because every one of them fails the same way. */
async function attempt(
  organizationId: string,
  path: string,
  run: () => Promise<unknown>,
): Promise<FormState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}${path}`);
  return { error: null };
}

export async function createOutcomeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  return attempt(organizationId, '/calls', () =>
    createCallOutcome(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      // An unticked checkbox is absent from the payload rather than false.
      reached: formData.get('reached') !== null,
      position: Number(formData.get('position') ?? 0),
    }),
  );
}

/** Write down a call that happened on somebody's mobile. */
export async function recordCallAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');
  const direction = String(formData.get('direction') ?? 'outbound');

  return attempt(organizationId, `/crm/contacts/${customerId}`, () =>
    recordCall(db, {
      organizationId,
      customerId,
      // Narrowed by the domain layer's own type and refused by the check constraint behind it;
      // this cast asserts nothing the database does not already enforce.
      direction: direction === 'inbound' ? 'inbound' : 'outbound',
      fromNumber: String(formData.get('fromNumber') ?? ''),
      toNumber: String(formData.get('toNumber') ?? ''),
    }),
  );
}

/**
 * How it went, filled in after the call.
 *
 * Reaches `apps/api/app/domains/communications/voice/wrap_up.py::wrap_up_call` under the
 * operator's own forwarded access token — the FastAPI-authoritative write for this
 * act, replacing what `recordCallOutcome` (formerly in `lib/domain/reception/calls.ts`) used to
 * perform as two separate requests to Postgres.
 */
export async function wrapUpCallAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const outcomeId = String(formData.get('outcomeId') ?? '');
  const duration = String(formData.get('durationSeconds') ?? '');

  return attempt(organizationId, '/calls', async () => {
    const token = await requireAccessToken(db);
    await wrapUpCall({
      token,
      organizationId,
      callId: String(formData.get('callId') ?? ''),
      // An empty select means nobody has said yet, which is a real answer and not a validation
      // failure.
      outcomeId: outcomeId === '' ? null : outcomeId,
      note: String(formData.get('note') ?? ''),
      durationSeconds: duration === '' ? null : Number(duration),
    });
  });
}

/**
 * The number this business dials from.
 *
 * `organization.manage` rather than `field.manage`, and decided by the policy rather than here:
 * naming a stage is configuring how a business records work, and the number its customers see
 * when it rings them is the business itself.
 */
export async function setCallingNumberAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  return attempt(organizationId, '/calls', async () => {
    const db = await getDb();
    // An empty field clears it — a business taking its number down rather than a mistake.
    // `set_calling_number` reads it as null, and dialling refuses again.
    await setCallingNumber(db, {
      organizationId,
      number: String(formData.get('number') ?? ''),
    });
  });
}

/** Say who an unknown caller was. */
export async function linkCallCustomerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const callId = String(formData.get('callId') ?? '');

  return attempt(organizationId, `/calls/${callId}`, () =>
    linkCallCustomer(db, {
      organizationId,
      callId,
      customerId: String(formData.get('customerId') ?? ''),
    }),
  );
}
