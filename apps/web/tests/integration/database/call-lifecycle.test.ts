import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginProviderBinding, recordProviderResource, setProviderBindingStatus } from '@/lib/domain/providers/bindings';
import { createCustomer } from '@/lib/domain/customers/customers';
import { getCall, getCallRecording, listCallPage, placeCall } from '@/lib/domain/reception/calls';
import {
  addCallParticipant,
  cancelTransfer,
  coldTransfer,
  completeTransfer,
  endCall,
  leaveCall,
  listCallParticipants,
  removeCallParticipant,
  setParticipantHold,
  warmTransfer,
} from '@/lib/domain/reception/conference';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import {
  assignPhoneNumber,
  configurePhoneNumber,
  getPhoneNumber,
  releasePhoneNumberAssignment,
  resolveOutboundNumber,
  setOutboundPreference,
} from '@/lib/domain/reception/numbers';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Phase F, against real Postgres with real RLS: a call is one business fact whose legs belong to the
 * carrier, and what a tenant can do to either is a database fact before it is ever a screen's.
 *
 * The carrier needs credentials this environment does not hold, so the one thing replaced is the
 * telephony adapter: a recorder standing where the carrier would, which also lets a test play the
 * carrier's side of a conversation (a leg answering, a leg leaving) through the same database door
 * the real callbacks use, under the same Postgres role. What this proves is the domain and the
 * database. It does not prove the carrier behaves as the adapter assumes; nothing here has rung a
 * real telephone.
 */

type Operation =
  | { kind: 'add'; room: string; from: string; to: string; id: string }
  | { kind: 'update'; room: string; externalId: string; hold?: boolean; muted?: boolean; status?: string; endsRoomOnExit?: boolean };

const carrier = vi.hoisted(() => ({
  operations: [] as unknown[],
  failAdd: false,
  failUpdate: false,
  /** Called when a participant is rung, so a test can play that telephone answering. */
  onAdd: null as null | ((id: string) => void),
}));

vi.mock('@/lib/adapters/telephony', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/adapters/telephony')>()),
  callbackBase: () => 'https://callbacks.example.test',
  telephonyProvider: async () => ({
    addToRoom: async (input: { room: string; from: string; to: string }) => {
      if (carrier.failAdd) throw new Error('the carrier refused');
      // Unique across runs, as a carrier's are: the database refuses to guess between two legs sharing one.
      const id = `CA${crypto.randomUUID().replace(/-/g, '')}`;
      carrier.operations.push({ kind: 'add', ...input, id });
      carrier.onAdd?.(id);
      return { externalId: id, status: 'ringing' as const };
    },
    browserToken: async () => 'token',
    updateParticipant: async (input: Record<string, unknown>) => {
      if (carrier.failUpdate) throw new Error('the carrier is unavailable');
      carrier.operations.push({ kind: 'update', ...input });
    },
    fetchRecording: async () => ({ body: new Response('audio').body!, contentType: 'audio/mpeg' }),
  }),
}));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; email: string; userId: string; organizationId: string; membershipId: string };

let pg: Client;
let staff: SupabaseClient;
let mine: Tenant;
let other: Tenant;
let myNumber: { id: string; e164: string };
let theirNumber: { id: string; e164: string };

const operations = () => carrier.operations as Operation[];
const phone = () => `+1416555${Math.floor(1000 + Math.random() * 8999)}`;

async function signIn(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const session = await db.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;
  return { db, email, userId: created.data.user.id };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, email, userId } = await signIn(label);
  // XXX: a currency nothing prices, so opening a call never waits on credit. The charge itself is
  // still recorded — usage is written whatever its pricing state — which is what is asserted.
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });
  const membershipId = (await currentMembershipId(db as never, { organizationId }))!;
  return { db, email, userId, organizationId, membershipId };
}

const callingAccounts = new Map<string, string>();
/** One calling account per business, as provisioning gives it. */
function callingAccountOf(tenant: Tenant): string {
  if (!callingAccounts.has(tenant.organizationId)) callingAccounts.set(tenant.organizationId, `AC${randomUUID().replace(/-/g, '')}`);
  return callingAccounts.get(tenant.organizationId)!;
}

/** A real provisioned number, through the one staff door that creates one. */
async function seedNumber(tenant: Tenant, e164 = phone()): Promise<{ id: string; e164: string; resourceId: string }> {
  await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
  // A business calls only from a calling account of its own, so the one a number lives in is active.
  await setProviderBindingStatus(staff, {
    organizationId: tenant.organizationId,
    providerKey: 'twilio',
    status: 'active',
    externalAccountId: callingAccountOf(tenant),
  });
  const resourceId = await recordProviderResource(staff, {
    organizationId: tenant.organizationId,
    providerKey: 'twilio',
    resourceType: 'twilio_phone_number',
    externalId: `PN${randomUUID().replace(/-/g, '').slice(0, 32)}`,
  });
  const { data, error } = await staff.rpc('sync_phone_number', {
    p_organization_id: tenant.organizationId,
    p_provider_resource_id: resourceId,
    p_e164: e164,
  });
  if (error) throw error;
  return { id: data as string, e164, resourceId };
}

/** What the voice integration does, under the Postgres role it really wears. */
async function asVoiceWebhook<T = unknown>(client: Client, sql: string, params: unknown[]): Promise<T> {
  await client.query('begin');
  try {
    await client.query('set local role voice_webhook');
    const result = await client.query(sql, params);
    await client.query('commit');
    return result.rows[0] as T;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

type EventInput = { status?: string | null; duration?: number | null; recording?: string | null; hash?: string; source?: string };

async function carrierSays(externalId: string, input: EventInput = {}, client: Client = pg): Promise<string | null> {
  const row = await asVoiceWebhook<{ record_call_event: string | null }>(
    client,
    `select public.record_call_event($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7)`,
    [externalId, input.source ?? 'status', input.status ?? null, input.status ?? null, input.duration ?? null, input.recording ?? null, input.hash ?? randomUUID()],
  );
  return row.record_call_event;
}

async function callRow(callId: string) {
  const { rows } = await pg.query(
    `select status, answered_at, ended_at, duration_seconds, customer_id, direction, from_number, to_number, phone_number_id, recording_available_at, outcome_id
       from public.calls where id = $1`,
    [callId],
  );
  return rows[0];
}

async function legs(callId: string) {
  const { rows } = await pg.query(
    `select id, party, status, external_id, left_at, joined_at, on_hold, membership_id from public.call_participants where call_id = $1 order by created_at`,
    [callId],
  );
  return rows as { id: string; party: string; status: string; external_id: string | null; left_at: string | null; joined_at: string | null; on_hold: boolean; membership_id: string | null }[];
}

async function usageFor(callId: string) {
  const { rows } = await pg.query(
    `select meter_id, quantity from public.usage_events where reference = $1 and meter_id = 'voice_minutes'`,
    [callId],
  );
  return rows as { meter_id: string; quantity: string }[];
}

/**
 * An outbound call as the product places it: `placeCall` with the fake carrier, the agent's browser
 * then joining the room as the carrier's TwiML request would report it.
 */
async function placeAndJoinAgent(tenant: Tenant, toNumber = phone()) {
  const placed = await placeCall(tenant.db as never, { organizationId: tenant.organizationId, toNumber });
  const room = (operations().filter((op) => op.kind === 'add').at(-1) as Extract<Operation, { kind: 'add' }>).room;
  const agentSid = `CA${randomUUID().replace(/-/g, '')}`;
  await asVoiceWebhook(pg, `select public.record_call_leg($1, $2)`, [room, agentSid]);
  const rows = await legs(placed.callId);
  return {
    callId: placed.callId,
    room,
    agentSid,
    customerSid: rows.find((leg) => leg.party === 'customer')!.external_id!,
    toNumber,
  };
}

/** Both telephones connected: the call is in progress. */
async function connect(call: { agentSid: string; customerSid: string }) {
  await carrierSays(call.customerSid, { status: 'in_progress' });
  await carrierSays(call.agentSid, { status: 'in_progress' });
}

beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  [mine, other, staff] = await Promise.all([newTenant('calls-a'), newTenant('calls-b'), asPlatformStaff()]);
  myNumber = await seedNumber(mine);
  theirNumber = await seedNumber(other);
  await assignPhoneNumber(mine.db as never, { organizationId: mine.organizationId, phoneNumberId: myNumber.id, memberId: mine.membershipId, isDefault: true });
  await assignPhoneNumber(other.db as never, { organizationId: other.organizationId, phoneNumberId: theirNumber.id, memberId: other.membershipId, isDefault: true });
}, 90_000);

afterAll(async () => {
  await pg?.end();
});

beforeEach(() => {
  carrier.operations.length = 0;
  carrier.failAdd = false;
  carrier.failUpdate = false;
  carrier.onAdd = null;
});

describe('an inbound call is recorded for the business whose number was rung', () => {
  it('derives the business from the called number, and an unknown caller is still a call', async () => {
    const callerNumber = phone();
    const sid = `CA${randomUUID().replace(/-/g, '')}`;
    const { record_inbound_call: callId } = await asVoiceWebhook<{ record_inbound_call: string }>(
      pg,
      `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`,
      [sid, myNumber.e164, callerNumber, randomUUID()],
    );
    expect(callId).toBeTruthy();

    const row = await callRow(callId);
    expect(row).toMatchObject({ direction: 'inbound', from_number: callerNumber, to_number: myNumber.e164, customer_id: null, phone_number_id: myNumber.id });

    // It is the business's call, readable by it, and invisible to everybody else.
    expect(await getCall(mine.db as never, { organizationId: mine.organizationId, callId })).toMatchObject({ direction: 'inbound', customerId: null, externalNumber: callerNumber });
    expect(await getCall(other.db as never, { organizationId: other.organizationId, callId })).toBeNull();
    expect(await getCall(other.db as never, { organizationId: mine.organizationId, callId })).toBeNull();
  });

  it('is the platform not answering, and says so: a missed call, with no minutes billed', async () => {
    const { record_inbound_call: callId } = await asVoiceWebhook<{ record_inbound_call: string }>(
      pg,
      `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`,
      [`CA${randomUUID().replace(/-/g, '')}`, myNumber.e164, phone(), randomUUID()],
    );
    expect(await callRow(callId)).toMatchObject({ status: 'no_answer', duration_seconds: null });
    expect(await usageFor(callId)).toEqual([]);
  });

  it('refuses a number no active business holds, and one that does not take calls', async () => {
    const unknown = await asVoiceWebhook<{ record_inbound_call: string | null }>(
      pg,
      `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`,
      [`CA${randomUUID().replace(/-/g, '')}`, '+14165550999', phone(), randomUUID()],
    );
    expect(unknown.record_inbound_call).toBeNull();

    const quiet = await seedNumber(mine);
    await configurePhoneNumber(mine.db as never, {
      organizationId: mine.organizationId, phoneNumberId: quiet.id, label: '', purpose: 'general',
      voiceInbound: false, voiceOutbound: true, smsInbound: true, smsOutbound: true,
    });
    const declined = await asVoiceWebhook<{ record_inbound_call: string | null }>(
      pg,
      `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`,
      [`CA${randomUUID().replace(/-/g, '')}`, quiet.e164, phone(), randomUUID()],
    );
    expect(declined.record_inbound_call).toBeNull();
  });

  it('is recorded once however many times the carrier retries', async () => {
    const sid = `CA${randomUUID().replace(/-/g, '')}`;
    const args = [sid, myNumber.e164, phone(), randomUUID()];
    const first = await asVoiceWebhook<{ record_inbound_call: string | null }>(pg, `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`, args);
    const second = await asVoiceWebhook<{ record_inbound_call: string | null }>(pg, `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`, args);
    expect(first.record_inbound_call).toBeTruthy();
    expect(second.record_inbound_call).toBeNull();
    const { rows } = await pg.query(`select count(*)::int as n from public.call_participants where external_id = $1`, [sid]);
    expect(rows[0].n).toBe(1);
  });

  it('records a withheld caller as a caller nobody can name', async () => {
    const { record_inbound_call: callId } = await asVoiceWebhook<{ record_inbound_call: string }>(
      pg,
      `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`,
      [`CA${randomUUID().replace(/-/g, '')}`, myNumber.e164, 'anonymous', randomUUID()],
    );
    expect(await callRow(callId)).toMatchObject({ from_number: null, customer_id: null });
    expect(await getCall(mine.db as never, { organizationId: mine.organizationId, callId })).toMatchObject({ externalNumber: null });
  });

  it('links the caller to a customer only when exactly one holds the number, and never creates one', async () => {
    const known = phone();
    const customerId = await createCustomer(mine.db as never, { organizationId: mine.organizationId, name: 'Known Caller', phone: known });
    const shared = phone();
    await createCustomer(mine.db as never, { organizationId: mine.organizationId, name: 'Shared One', phone: shared });
    await createCustomer(mine.db as never, { organizationId: mine.organizationId, name: 'Shared Two', phone: shared });
    const customersBefore = (await pg.query(`select count(*)::int as n from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].n;

    const call = async (from: string) =>
      (await asVoiceWebhook<{ record_inbound_call: string }>(pg, `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`, [`CA${randomUUID().replace(/-/g, '')}`, myNumber.e164, from, randomUUID()])).record_inbound_call;

    expect((await callRow(await call(known))).customer_id).toBe(customerId);
    expect((await callRow(await call(shared))).customer_id).toBeNull();
    expect((await callRow(await call(phone()))).customer_id).toBeNull();
    expect((await pg.query(`select count(*)::int as n from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].n).toBe(customersBefore);
  });

  it('cannot be told which business by the carrier: the function takes no organization', async () => {
    const { rows } = await pg.query(`select pg_get_function_arguments(oid) as args from pg_proc where proname in ('record_inbound_call', 'record_call_event', 'record_call_leg')`);
    for (const row of rows) expect(row.args).not.toMatch(/organization/);
  });
});

describe('an outbound call resolves its sender on the server', () => {
  it('rings from the number the server resolved, records which number it was on, and remembers the customer leg', async () => {
    const call = await placeAndJoinAgent(mine);
    expect(operations()[0]).toMatchObject({ kind: 'add', from: myNumber.e164, to: call.toNumber });
    expect(await callRow(call.callId)).toMatchObject({ direction: 'outbound', from_number: myNumber.e164, phone_number_id: myNumber.id, status: 'ringing' });
    expect(call.customerSid).toMatch(/^CA/);
    expect((await legs(call.callId)).find((leg) => leg.party === 'agent')!.membership_id).toBe(mine.membershipId);
  });

  it('never accepts a number the caller merely names: another business’s number is refused before anything rings', async () => {
    await expect(placeCall(mine.db as never, { organizationId: mine.organizationId, toNumber: phone(), phoneNumberId: theirNumber.id })).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    expect(operations()).toEqual([]);
  });

  it('can be placed from one of the caller’s own other numbers, and from no one else’s', async () => {
    const second = await seedNumber(mine);
    await expect(placeCall(mine.db as never, { organizationId: mine.organizationId, toNumber: phone(), phoneNumberId: second.id })).rejects.toMatchObject({ code: 'calls.no_calling_number' });

    await assignPhoneNumber(mine.db as never, { organizationId: mine.organizationId, phoneNumberId: second.id, memberId: mine.membershipId });
    await placeCall(mine.db as never, { organizationId: mine.organizationId, toNumber: phone(), phoneNumberId: second.id });
    expect(operations()[0]).toMatchObject({ kind: 'add', from: second.e164 });
  });

  it('records a call to a number nobody has recorded, and links it when exactly one customer holds it', async () => {
    const unknown = await placeAndJoinAgent(mine);
    expect((await callRow(unknown.callId)).customer_id).toBeNull();

    const number = phone();
    const customerId = await createCustomer(mine.db as never, { organizationId: mine.organizationId, name: 'Callee', phone: number });
    const known = await placeAndJoinAgent(mine, number);
    expect((await callRow(known.callId)).customer_id).toBe(customerId);
  });

  it('marks a call failed, with no minutes and nobody left ringing, when the carrier refuses', async () => {
    carrier.failAdd = true;
    await expect(placeCall(mine.db as never, { organizationId: mine.organizationId, toNumber: phone() })).rejects.toMatchObject({ code: 'calls.dial_failed' });
    const { rows } = await pg.query(
      `select c.id, c.status from public.calls c where c.organization_id = $1 and c.status = 'failed' order by c.created_at desc limit 1`,
      [mine.organizationId],
    );
    expect(rows[0].status).toBe('failed');
    expect(await usageFor(rows[0].id)).toEqual([]);
    expect((await legs(rows[0].id)).every((leg) => leg.left_at !== null)).toBe(true);
  });

  it('refuses a malformed number without opening a call', async () => {
    const before = (await pg.query(`select count(*)::int as n from public.calls where organization_id = $1`, [mine.organizationId])).rows[0].n;
    await expect(placeCall(mine.db as never, { organizationId: mine.organizationId, toNumber: '4165550142' })).rejects.toMatchObject({ code: 'calls.number_invalid' });
    expect((await pg.query(`select count(*)::int as n from public.calls where organization_id = $1`, [mine.organizationId])).rows[0].n).toBe(before);
  });
});

describe('a call is settled from all of its legs, forward only', () => {
  it('is answered when two legs are connected, not when the first is', async () => {
    const call = await placeAndJoinAgent(mine);
    await carrierSays(call.agentSid, { status: 'in_progress' });
    expect(await callRow(call.callId)).toMatchObject({ status: 'ringing', answered_at: null });

    await carrierSays(call.customerSid, { status: 'in_progress' });
    const row = await callRow(call.callId);
    expect(row.status).toBe('in_progress');
    expect(row.answered_at).not.toBeNull();
  });

  it('is not ended by one leg leaving, and is billed once when the last does, for the longest any leg was connected', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);

    // The agent leaves (a cold transfer, say): the call is still going and nothing is billed.
    await carrierSays(call.agentSid, { status: 'completed', duration: 40 });
    expect(await callRow(call.callId)).toMatchObject({ status: 'in_progress', ended_at: null });
    expect(await usageFor(call.callId)).toEqual([]);

    await carrierSays(call.customerSid, { status: 'completed', duration: 95 });
    const row = await callRow(call.callId);
    expect(row.status).toBe('completed');
    expect(row.duration_seconds).toBe(95);
    expect(row.ended_at).not.toBeNull();
    expect(await usageFor(call.callId)).toEqual([{ meter_id: 'voice_minutes', quantity: '2' }]);
  });

  it('bills a three-party conference as one call, not three', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const { participantId } = await addCallParticipant(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, party: 'transfer_target', toNumber: phone() });
    const target = (await legs(call.callId)).find((leg) => leg.id === participantId)!;
    await carrierSays(target.external_id!, { status: 'in_progress' });

    await carrierSays(call.agentSid, { status: 'completed', duration: 120 });
    await carrierSays(target.external_id!, { status: 'completed', duration: 70 });
    await carrierSays(call.customerSid, { status: 'completed', duration: 125 });

    expect((await callRow(call.callId)).duration_seconds).toBe(125);
    expect(await usageFor(call.callId)).toEqual([{ meter_id: 'voice_minutes', quantity: '3' }]);
  });

  it('never moves backward: a late ringing, or a second ending, changes nothing', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    await carrierSays(call.customerSid, { status: 'ringing' });
    expect((await legs(call.callId)).find((leg) => leg.party === 'customer')!.status).toBe('in_progress');
    expect((await callRow(call.callId)).status).toBe('in_progress');

    await carrierSays(call.customerSid, { status: 'completed', duration: 30 });
    await carrierSays(call.agentSid, { status: 'completed', duration: 30 });
    expect((await callRow(call.callId)).status).toBe('completed');

    await carrierSays(call.customerSid, { status: 'ringing' });
    await carrierSays(call.customerSid, { status: 'failed' });
    expect((await callRow(call.callId)).status).toBe('completed');
    expect(await usageFor(call.callId)).toHaveLength(1);
  });

  it('applies a retried callback once', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const hash = randomUUID();
    expect(await carrierSays(call.customerSid, { status: 'completed', duration: 61, hash })).toBeTruthy();
    expect(await carrierSays(call.customerSid, { status: 'completed', duration: 61, hash })).toBeNull();
    const { rows } = await pg.query(`select count(*)::int as n from public.call_events where call_id = $1 and payload_hash = $2`, [call.callId, hash]);
    expect(rows[0].n).toBe(1);
  });

  it('ignores a callback about a leg this platform never placed', async () => {
    expect(await carrierSays(`CA${randomUUID().replace(/-/g, '')}`, { status: 'completed', duration: 99 })).toBeNull();
  });

  it('records the carrier’s word for why a call that was never answered ended, and bills nothing', async () => {
    for (const reason of ['busy', 'no_answer', 'failed'] as const) {
      const call = await placeAndJoinAgent(mine);
      await carrierSays(call.agentSid, { status: 'in_progress' });
      await carrierSays(call.customerSid, { status: reason });
      await carrierSays(call.agentSid, { status: 'completed', duration: 0 });
      expect(await callRow(call.callId)).toMatchObject({ status: reason, answered_at: null });
      expect(await usageFor(call.callId)).toEqual([]);
    }
  });

  it('settles correctly when two legs report at the same instant', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const second = new Client({ connectionString: CONNECTION });
    await second.connect();
    try {
      await Promise.all([
        carrierSays(call.agentSid, { status: 'completed', duration: 59 }),
        carrierSays(call.customerSid, { status: 'completed', duration: 60 }, second),
      ]);
    } finally {
      await second.end();
    }
    expect((await callRow(call.callId)).status).toBe('completed');
    expect(await usageFor(call.callId)).toHaveLength(1);
  });

  it('keeps a recording as a reference that only a person who may play it can obtain', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    await carrierSays(call.customerSid, { source: 'recording', recording: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3', hash: randomUUID() });
    expect((await callRow(call.callId)).recording_available_at).not.toBeNull();
    expect(await getCall(mine.db as never, { organizationId: mine.organizationId, callId: call.callId })).toMatchObject({ hasRecording: true });

    // The address itself is not a column a member can read.
    const direct = await mine.db.from('calls').select('recording_url').eq('id', call.callId);
    expect(direct.error).not.toBeNull();

    expect(await getCallRecording(mine.db as never, { organizationId: mine.organizationId, callId: call.callId })).not.toBeNull();
    // Another business gets the same refusal as a call that does not exist; nothing is fetched.
    await expect(getCallRecording(other.db as never, { organizationId: mine.organizationId, callId: call.callId })).rejects.toMatchObject({ code: 'calls.recording_refused' });
    expect(await getCallRecording(other.db as never, { organizationId: other.organizationId, callId: call.callId })).toBeNull();
  });
});

describe('what a tenant can and cannot write onto a call', () => {
  it('cannot move a call’s status, ending or duration, by any route', async () => {
    const call = await placeAndJoinAgent(mine);
    const update = await mine.db.from('calls').update({ status: 'completed', duration_seconds: 5000 }).eq('id', call.callId);
    expect(update.error).not.toBeNull();
    expect((await callRow(call.callId)).status).toBe('ringing');

    // And the database itself refuses to run a status backward, whoever asks.
    await connect(call);
    await carrierSays(call.customerSid, { status: 'completed', duration: 10 });
    await carrierSays(call.agentSid, { status: 'completed', duration: 10 });
    await expect(pg.query(`update public.calls set status = 'ringing' where id = $1`, [call.callId])).rejects.toThrow(/only moves forward/);
    await expect(pg.query(`update public.call_participants set status = 'ringing' where call_id = $1 and party = 'customer'`, [call.callId])).rejects.toThrow(/only moves forward/);
  });

  it('cannot write a participant, or learn another business’s leg', async () => {
    const call = await placeAndJoinAgent(mine);
    const insert = await mine.db.from('call_participants').insert({ organization_id: mine.organizationId, call_id: call.callId, party: 'customer' });
    expect(insert.error).not.toBeNull();

    const theirs = await placeAndJoinAgent(other);
    const customerLeg = (await legs(theirs.callId)).find((leg) => leg.party === 'customer')!;
    const seen = await mine.db.from('call_participants').select('id').eq('id', customerLeg.id);
    expect(seen.data).toEqual([]);
  });

  it('cannot overwrite a leg’s provider identifier once the carrier has named it', async () => {
    const call = await placeAndJoinAgent(mine);
    const customerLeg = (await legs(call.callId)).find((leg) => leg.party === 'customer')!;
    const { error } = await mine.db.rpc('set_call_leg_provider_id', {
      p_organization_id: mine.organizationId, p_participant_id: customerLeg.id, p_external_id: 'CAforged',
    });
    expect(error).not.toBeNull();
    expect((await legs(call.callId)).find((leg) => leg.id === customerLeg.id)!.external_id).toBe(call.customerSid);
  });

  it('cannot control, link, play or fail another business’s call', async () => {
    const theirs = await placeAndJoinAgent(other);
    const theirLeg = (await legs(theirs.callId)).find((leg) => leg.party === 'customer')!;

    // Naming my own organization with their ids: nothing matches. Naming theirs: I am not a member.
    for (const organizationId of [mine.organizationId, other.organizationId]) {
      expect((await mine.db.rpc('set_participant_hold', { p_organization_id: organizationId, p_participant_id: theirLeg.id, p_hold: true })).error).not.toBeNull();
      expect((await mine.db.rpc('remove_call_participant', { p_organization_id: organizationId, p_participant_id: theirLeg.id })).error).not.toBeNull();
      expect((await mine.db.rpc('fail_call_attempt', { p_organization_id: organizationId, p_call_id: theirs.callId })).error).not.toBeNull();
      expect((await mine.db.rpc('call_recording_reference', { p_organization_id: organizationId, p_call_id: theirs.callId })).data ?? null).toBeNull();
      expect((await mine.db.rpc('link_call_customer', { p_organization_id: organizationId, p_call_id: theirs.callId, p_customer_id: randomUUID() })).error).not.toBeNull();
    }
    expect((await legs(theirs.callId)).find((leg) => leg.id === theirLeg.id)!.on_hold).toBe(false);

    await expect(setParticipantHold(mine.db as never, { organizationId: mine.organizationId, callId: theirs.callId, participantId: theirLeg.id, hold: true })).rejects.toMatchObject({ code: 'conference.no_call' });
    await expect(endCall(mine.db as never, { organizationId: mine.organizationId, callId: theirs.callId })).rejects.toMatchObject({ code: 'conference.no_call' });
  });

  it('keeps a member without call.place from controlling a live call', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);

    // Signed in after the membership exists, because the tenant claim is read at sign-in.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = `viewer-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const roleId = await createRole(mine.db as never, { organizationId: mine.organizationId, name: `Viewer ${randomUUID().slice(0, 8)}`, capabilities: [] });
    await addMember(mine.db as never, { organizationId: mine.organizationId, email, displayName: 'Viewer', roleId });
    const viewer = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    expect((await viewer.auth.signInWithPassword({ email, password })).error).toBeNull();

    // They can read the business’s calls...
    expect((await viewer.from('calls').select('id').eq('id', call.callId)).data).toHaveLength(1);

    // ...and cannot touch a single one.
    const customerLeg = (await legs(call.callId)).find((leg) => leg.party === 'customer')!;
    const args = { p_organization_id: mine.organizationId };
    expect((await viewer.rpc('set_participant_hold', { ...args, p_participant_id: customerLeg.id, p_hold: true })).error).not.toBeNull();
    expect((await viewer.rpc('remove_call_participant', { ...args, p_participant_id: customerLeg.id })).error).not.toBeNull();
    expect((await viewer.rpc('add_call_participant', { ...args, p_call_id: call.callId, p_party: 'supervisor' })).error).not.toBeNull();
    expect((await viewer.rpc('fail_call_attempt', { ...args, p_call_id: call.callId })).error).not.toBeNull();
    expect((await viewer.rpc('call_recording_reference', { ...args, p_call_id: call.callId })).error).not.toBeNull();
    expect((await legs(call.callId)).find((leg) => leg.id === customerLeg.id)!.on_hold).toBe(false);
  });

  it('wrapping up says how it went without touching what the carrier said', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    await carrierSays(call.customerSid, { status: 'completed', duration: 77 });
    await carrierSays(call.agentSid, { status: 'completed', duration: 77 });
    const { data: outcome } = await mine.db.from('call_outcomes').insert({ organization_id: mine.organizationId, name: `Talked ${randomUUID().slice(0, 4)}`, reached: true, created_by: mine.userId }).select('id').single();
    const { error } = await mine.db.rpc('record_call_outcome', {
      p_organization_id: mine.organizationId, p_call_id: call.callId, p_outcome_id: outcome!.id, p_note: 'Booked.', p_duration_seconds: 5,
    });
    expect(error).toBeNull();
    expect(await callRow(call.callId)).toMatchObject({ status: 'completed', duration_seconds: 77, outcome_id: outcome!.id });
  });

  it('lets a person say who an unknown caller was, once, and only a customer of this business', async () => {
    const { record_inbound_call: callId } = await asVoiceWebhook<{ record_inbound_call: string }>(
      pg, `select public.record_inbound_call($1, $2, $3, '{}'::jsonb, $4)`, [`CA${randomUUID().replace(/-/g, '')}`, myNumber.e164, phone(), randomUUID()],
    );
    const theirCustomer = await createCustomer(other.db as never, { organizationId: other.organizationId, name: 'Not mine' });
    const refused = await mine.db.rpc('link_call_customer', { p_organization_id: mine.organizationId, p_call_id: callId, p_customer_id: theirCustomer });
    expect(refused.error).not.toBeNull();

    const customerId = await createCustomer(mine.db as never, { organizationId: mine.organizationId, name: 'Now known' });
    expect((await mine.db.rpc('link_call_customer', { p_organization_id: mine.organizationId, p_call_id: callId, p_customer_id: customerId })).error).toBeNull();
    expect((await callRow(callId)).customer_id).toBe(customerId);
    expect((await mine.db.rpc('link_call_customer', { p_organization_id: mine.organizationId, p_call_id: callId, p_customer_id: customerId })).error).not.toBeNull();
  });
});

describe('the history is paged and filtered by the database', () => {
  it('lists inbound and outbound together, filters on canonical data and pages without skipping or repeating', async () => {
    const tenant = await newTenant('paged');
    const number = await seedNumber(tenant);
    for (let index = 0; index < 7; index++) {
      await pg.query(
        `insert into public.calls (organization_id, direction, status, from_number, to_number, phone_number_id, started_at, created_by)
         values ($1, $2, 'completed', '+14165550101', '+14165550102', $3, now() - ($4 || ' minutes')::interval, $5)`,
        [tenant.organizationId, index % 2 === 0 ? 'inbound' : 'outbound', number.id, String(index + 1), tenant.userId],
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listCallPage>> = await listCallPage(tenant.db as never, { organizationId: tenant.organizationId, cursor, limit: 3 });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((call) => call.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);

    const inbound = await listCallPage(tenant.db as never, { organizationId: tenant.organizationId, filter: { direction: 'inbound' } });
    expect(inbound.items).toHaveLength(4);
    expect(inbound.items.every((call) => call.direction === 'inbound')).toBe(true);
    const otherNumber = await listCallPage(tenant.db as never, { organizationId: tenant.organizationId, filter: { phoneNumberId: randomUUID() } });
    expect(otherNumber.items).toEqual([]);

    // Another business sees none of it, whatever it asks for.
    expect((await listCallPage(other.db as never, { organizationId: tenant.organizationId })).items).toEqual([]);
  });
});

describe('live controls tell the truth about what the carrier did', () => {
  it('holds only after the carrier agrees, and leaves the call as it was when it does not', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const customerLeg = (await legs(call.callId)).find((leg) => leg.party === 'customer')!;

    carrier.failUpdate = true;
    await expect(setParticipantHold(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, participantId: customerLeg.id, hold: true })).rejects.toMatchObject({ code: 'conference.hold_failed' });
    expect((await legs(call.callId)).find((leg) => leg.id === customerLeg.id)!.on_hold).toBe(false);

    carrier.failUpdate = false;
    await setParticipantHold(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, participantId: customerLeg.id, hold: true });
    expect(operations().at(-1)).toMatchObject({ kind: 'update', externalId: call.customerSid, hold: true });
    expect((await legs(call.callId)).find((leg) => leg.id === customerLeg.id)!.on_hold).toBe(true);
  });

  it('will not claim a control on a leg the carrier has not named yet', async () => {
    const call = await placeAndJoinAgent(mine);
    carrier.onAdd = null;
    const { data: pendingId } = await mine.db.rpc('add_call_participant', { p_organization_id: mine.organizationId, p_call_id: call.callId, p_party: 'transfer_target' });
    await expect(setParticipantHold(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, participantId: pendingId as string, hold: true })).rejects.toMatchObject({ code: 'conference.not_connected' });
    await expect(removeCallParticipant(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, participantId: pendingId as string })).rejects.toMatchObject({ code: 'conference.not_connected' });
    expect((await legs(call.callId)).find((leg) => leg.id === pendingId)!.on_hold).toBe(false);
  });

  it('withdraws a participant the carrier refused to ring, and the call carries on', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    carrier.failAdd = true;
    await expect(addCallParticipant(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, party: 'transfer_target', toNumber: phone() })).rejects.toMatchObject({ code: 'conference.add_failed' });
    const rows = await legs(call.callId);
    expect(rows.filter((leg) => leg.party === 'transfer_target').every((leg) => leg.left_at !== null)).toBe(true);
    expect((await callRow(call.callId)).status).toBe('in_progress');
  });

  it('refuses any control on a call that has ended', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    await carrierSays(call.customerSid, { status: 'completed', duration: 10 });
    await carrierSays(call.agentSid, { status: 'completed', duration: 10 });
    await expect(addCallParticipant(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, party: 'transfer_target', toNumber: phone() })).rejects.toMatchObject({ code: 'conference.call_ended' });
  });

  it('removes one leg without ending the room for the rest, by turning off “ends the room on exit” first', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    carrier.onAdd = (id) => void carrierSays(id, { status: 'in_progress' });
    const { participantId } = await addCallParticipant(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, party: 'supervisor', toNumber: phone() });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const before = operations().length;

    await removeCallParticipant(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, participantId });
    const sent = operations().slice(before) as Extract<Operation, { kind: 'update' }>[];
    expect(sent.map((op) => [op.endsRoomOnExit, op.status])).toEqual([[false, undefined], [undefined, 'completed']]);
    expect((await callRow(call.callId)).status).toBe('in_progress');
  });

  it('hangs up every line when the whole call is ended', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const before = operations().length;
    await endCall(mine.db as never, { organizationId: mine.organizationId, callId: call.callId });
    const hungUp = (operations().slice(before) as Extract<Operation, { kind: 'update' }>[]).map((op) => op.externalId).sort();
    expect(hungUp).toEqual([call.agentSid, call.customerSid].sort());
  });

  it('leaves a call without ending it', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const before = operations().length;
    await leaveCall(mine.db as never, { organizationId: mine.organizationId, callId: call.callId });
    expect(operations().slice(before)).toEqual([{ kind: 'update', room: call.room, externalId: call.agentSid, endsRoomOnExit: false }]);
  });
});

describe('transfers keep one canonical call', () => {
  const callCount = async (tenant: Tenant) => (await pg.query(`select count(*)::int as n from public.calls where organization_id = $1`, [tenant.organizationId])).rows[0].n as number;

  it('a cold transfer rings the target, releases the agent only once it answers, and stays one call', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const callsBefore = await callCount(mine);
    carrier.onAdd = (id) => void setTimeout(() => void carrierSays(id, { status: 'in_progress' }), 100);

    const target = await coldTransfer(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, toNumber: phone(), waitMs: 5000 });

    const sent = operations().filter((op) => op.kind === 'update').at(-1) as Extract<Operation, { kind: 'update' }>;
    expect(sent).toMatchObject({ externalId: call.agentSid, endsRoomOnExit: false });
    expect(await callCount(mine)).toBe(callsBefore);
    const rows = await legs(call.callId);
    expect(rows.filter((leg) => leg.id === target.participantId)).toHaveLength(1);

    // The agent’s telephone then leaves; the customer and the target are still on the same call.
    await carrierSays(call.agentSid, { status: 'completed', duration: 20 });
    const after = await callRow(call.callId);
    expect(after.status).toBe('in_progress');
    expect(after.ended_at).toBeNull();
    expect(await usageFor(call.callId)).toEqual([]);
  });

  it('a cold transfer to someone who never answers fails, hangs the target up, and the agent is still there', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    const before = operations().length;

    await expect(coldTransfer(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, toNumber: phone(), waitMs: 1200 })).rejects.toMatchObject({ code: 'conference.transfer_unanswered' });

    const sent = operations().slice(before) as Operation[];
    expect(sent.some((op) => op.kind === 'update' && op.externalId === call.agentSid)).toBe(false);
    expect((await legs(call.callId)).find((leg) => leg.party === 'agent')!.left_at).toBeNull();
    expect((await callRow(call.callId)).status).toBe('in_progress');
  });

  it('a warm transfer holds the caller, keeps the agent, and completes or cancels', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    carrier.onAdd = (id) => void setTimeout(() => void carrierSays(id, { status: 'in_progress' }), 100);
    const callsBefore = await callCount(mine);

    await warmTransfer(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, toNumber: phone() });
    expect((await legs(call.callId)).find((leg) => leg.party === 'customer')!.on_hold).toBe(true);
    expect((await legs(call.callId)).find((leg) => leg.party === 'agent')!.left_at).toBeNull();

    await expect(completeTransfer(mine.db as never, { organizationId: mine.organizationId, callId: call.callId })).rejects.toMatchObject({ code: 'conference.target_not_connected' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    await completeTransfer(mine.db as never, { organizationId: mine.organizationId, callId: call.callId });
    expect((await legs(call.callId)).find((leg) => leg.party === 'customer')!.on_hold).toBe(false);
    expect(operations().at(-1)).toMatchObject({ externalId: call.agentSid, endsRoomOnExit: false });
    expect(await callCount(mine)).toBe(callsBefore);
  });

  it('cancelling a warm transfer drops the target and takes the caller off hold', async () => {
    const call = await placeAndJoinAgent(mine);
    await connect(call);
    carrier.onAdd = (id) => void setTimeout(() => void carrierSays(id, { status: 'in_progress' }), 50);
    await warmTransfer(mine.db as never, { organizationId: mine.organizationId, callId: call.callId, toNumber: phone() });
    await new Promise((resolve) => setTimeout(resolve, 300));

    await cancelTransfer(mine.db as never, { organizationId: mine.organizationId, callId: call.callId });
    const rows = await legs(call.callId);
    expect(rows.find((leg) => leg.party === 'customer')!.on_hold).toBe(false);
    expect(rows.find((leg) => leg.party === 'transfer_target')!.left_at).not.toBeNull();
    expect(listCallParticipants).toBeDefined();
  });
});

describe('a number says what it can do, and whether it is ready is read, never stored', () => {
  it('carries the business’s own name, purpose and capabilities, written only through the configuring door', async () => {
    const number = await seedNumber(mine);
    await configurePhoneNumber(mine.db as never, {
      organizationId: mine.organizationId, phoneNumberId: number.id, label: 'Front desk', purpose: 'reception',
      voiceInbound: true, voiceOutbound: true, smsInbound: false, smsOutbound: false,
    });
    expect(await getPhoneNumber(mine.db as never, { organizationId: mine.organizationId, phoneNumberId: number.id })).toMatchObject({
      label: 'Front desk', purpose: 'reception', voiceInboundEnabled: true, voiceOutboundEnabled: true, smsInboundEnabled: false, smsOutboundEnabled: false, origin: 'provisioned',
    });

    // A tenant cannot reach where the number came from or what stands behind it.
    const direct = await mine.db.from('phone_numbers').update({ origin: 'external', provider_resource_id: null }).eq('id', number.id);
    expect(direct.error).not.toBeNull();
    const other_ = await configurePhoneNumber(other.db as never, {
      organizationId: mine.organizationId, phoneNumberId: number.id, label: 'Mine now', purpose: 'general',
      voiceInbound: true, voiceOutbound: true, smsInbound: true, smsOutbound: true,
    }).then(() => 'allowed', () => 'refused');
    expect(other_).toBe('refused');
  });

  it('is never told by staff syncing it again to forget the name the business gave it', async () => {
    const number = await seedNumber(mine);
    await configurePhoneNumber(mine.db as never, {
      organizationId: mine.organizationId, phoneNumberId: number.id, label: 'Keep me', purpose: 'general',
      voiceInbound: true, voiceOutbound: true, smsInbound: true, smsOutbound: true,
    });
    const { error } = await staff.rpc('sync_phone_number', { p_organization_id: mine.organizationId, p_provider_resource_id: number.resourceId, p_e164: number.e164 });
    expect(error).toBeNull();
    expect((await getPhoneNumber(mine.db as never, { organizationId: mine.organizationId, phoneNumberId: number.id }))!.label).toBe('Keep me');
  });

  it('cannot take inbound traffic unless GildOps holds the number', async () => {
    const number = await seedNumber(mine);
    await pg.query(`update public.phone_numbers set origin = 'external', provider_resource_id = null, voice_inbound_enabled = false, sms_inbound_enabled = false where id = $1`, [number.id]);
    await expect(configurePhoneNumber(mine.db as never, {
      organizationId: mine.organizationId, phoneNumberId: number.id, label: '', purpose: 'general',
      voiceInbound: true, voiceOutbound: true, smsInbound: false, smsOutbound: false,
    })).rejects.toMatchObject({ code: 'numbers.configure_failed' });
    await expect(pg.query(`update public.phone_numbers set voice_inbound_enabled = true where id = $1`, [number.id])).rejects.toThrow(/inbound_needs_a_number_we_hold/);

    // It can still be a caller id for outbound calls.
    expect(await getPhoneNumber(mine.db as never, { organizationId: mine.organizationId, phoneNumberId: number.id })).toMatchObject({ readiness: 'ready', voiceOutboundEnabled: true });
  });

  it('is ready only while the provider’s own state says so', async () => {
    const number = await seedNumber(mine);
    const readiness = async () => (await getPhoneNumber(mine.db as never, { organizationId: mine.organizationId, phoneNumberId: number.id }))!.readiness;
    expect(await readiness()).toBe('ready');

    await pg.query(`update public.organization_provider_resources set status = 'pending' where id = $1`, [number.resourceId]);
    expect(await readiness()).toBe('setup_required');
    await pg.query(`update public.organization_provider_resources set status = 'failed' where id = $1`, [number.resourceId]);
    expect(await readiness()).toBe('degraded');
    await pg.query(`update public.organization_provider_resources set status = 'disabled' where id = $1`, [number.resourceId]);
    expect(await readiness()).toBe('unavailable');
    await pg.query(`update public.organization_provider_resources set status = 'active' where id = $1`, [number.resourceId]);
    expect(await readiness()).toBe('ready');
    await pg.query(`update public.phone_numbers set lifecycle = 'inactive' where id = $1`, [number.id]);
    expect(await readiness()).toBe('unavailable');
  });

  it('resolves the number someone dials from in one place: preference, then their default, then the business’s, and never a number that is not ready', async () => {
    const tenant = await newTenant('resolve');
    const first = await seedNumber(tenant);
    const second = await seedNumber(tenant);
    const third = await seedNumber(tenant);
    const resolve = () => resolveOutboundNumber(tenant.db as never, { organizationId: tenant.organizationId });

    expect(await resolve()).toBeNull();

    await assignPhoneNumber(tenant.db as never, { organizationId: tenant.organizationId, phoneNumberId: first.id, memberId: tenant.membershipId, isDefault: true });
    expect(await resolve()).toMatchObject({ phoneNumberId: first.id, source: 'member_default' });

    await assignPhoneNumber(tenant.db as never, { organizationId: tenant.organizationId, phoneNumberId: second.id, memberId: tenant.membershipId });
    await setOutboundPreference(tenant.db as never, { organizationId: tenant.organizationId, phoneNumberId: second.id });
    expect(await resolve()).toMatchObject({ phoneNumberId: second.id, source: 'preference' });

    // Assigning the same number again is choosing its default, not a second assignment.
    await assignPhoneNumber(tenant.db as never, { organizationId: tenant.organizationId, phoneNumberId: first.id, memberId: tenant.membershipId, isDefault: true });
    const { rows } = await pg.query(`select count(*)::int as n from public.phone_number_assignments where organization_id = $1 and phone_number_id = $2 and released_at is null`, [tenant.organizationId, first.id]);
    expect(rows[0].n).toBe(1);

    // A number that is not ready is passed over for the next.
    await pg.query(`update public.organization_provider_resources set status = 'failed' where id = $1`, [second.resourceId]);
    expect(await resolve()).toMatchObject({ phoneNumberId: first.id });

    // Naming one asks whether it is allowed; a number the person has no claim on is refused.
    expect(await resolveOutboundNumber(tenant.db as never, { organizationId: tenant.organizationId, phoneNumberId: third.id })).toBeNull();
    expect(await resolveOutboundNumber(tenant.db as never, { organizationId: tenant.organizationId, phoneNumberId: first.id })).toMatchObject({ phoneNumberId: first.id });

    // Another business answers nothing about this one.
    expect(await resolveOutboundNumber(other.db as never, { organizationId: tenant.organizationId })).toBeNull();

    // Releasing the default falls back, and a released assignment is history.
    const { data: active } = await tenant.db.from('phone_number_assignments').select('id, phone_number_id').eq('organization_id', tenant.organizationId).is('released_at', null);
    for (const assignment of active ?? []) await releasePhoneNumberAssignment(tenant.db as never, { organizationId: tenant.organizationId, assignmentId: assignment.id });
    expect(await resolve()).toBeNull();
  });

  it('keeps assignments to a business’s own members', async () => {
    const number = await seedNumber(mine);
    await expect(assignPhoneNumber(mine.db as never, { organizationId: mine.organizationId, phoneNumberId: number.id, memberId: other.membershipId })).rejects.toBeDefined();
    await expect(assignPhoneNumber(other.db as never, { organizationId: mine.organizationId, phoneNumberId: number.id, memberId: mine.membershipId })).rejects.toBeDefined();
  });
});

describe('a business calls only from a calling account of its own', () => {
  it('refuses a call, a browser telephone and a recording for a business that has none, and rings nobody', async () => {
    const { browserTelephoneToken } = await import('@/lib/domain/reception/calls');
    const without = await newTenant('no-account');
    const before = operations().length;

    await expect(placeCall(without.db as never, { organizationId: without.organizationId, toNumber: phone() })).rejects.toMatchObject({
      code: 'calls.telephony_unconfigured',
    });
    await expect(browserTelephoneToken(without.db as never, { organizationId: without.organizationId })).rejects.toMatchObject({
      code: 'calls.telephony_unconfigured',
    });

    expect(operations().length).toBe(before);
    const { rows } = await pg.query('select count(*)::int as calls from public.calls where organization_id = $1', [without.organizationId]);
    expect(rows[0].calls).toBe(0);
  });

  it('refuses the same for a business whose calling account is suspended', async () => {
    const suspended = await newTenant('suspended-account');
    await seedNumber(suspended);
    await setProviderBindingStatus(staff, { organizationId: suspended.organizationId, providerKey: 'twilio', status: 'suspended' });
    const before = operations().length;

    await expect(placeCall(suspended.db as never, { organizationId: suspended.organizationId, toNumber: phone() })).rejects.toMatchObject({
      code: 'calls.telephony_unconfigured',
    });

    expect(operations().length).toBe(before);
  });
});
