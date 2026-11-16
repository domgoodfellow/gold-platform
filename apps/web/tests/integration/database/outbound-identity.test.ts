import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCallingOptions } from '@/lib/application/communications/calling-options';
import { addToCallList } from '@/lib/application/communications/call-list';
import { createContact } from '@/lib/domain/contacts/contacts';
import { beginProviderBinding, recordProviderResource, setProviderBindingStatus } from '@/lib/domain/providers/bindings';
import { callContact, callListContacts, dialerContactCandidates, placeCall } from '@/lib/domain/reception/calls';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import {
  assignPhoneNumber,
  configurePhoneNumber,
  listOutboundNumberOptions,
  listPhoneNumberAssignments,
  listPhoneNumbers,
  releasePhoneNumberAssignment,
  resolveOutboundNumber,
  setOutboundPreference,
  setOutboundSharing,
} from '@/lib/domain/reception/numbers';
import { setCallingNumber } from '@/lib/domain/reception/telephony';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Outbound identity against real Postgres with real RLS: which of a business's numbers a person
 * may call from, why, and that the answer a screen is given is the answer a placed call gets.
 * Also the contact a call is linked to, read from the call and never from a phone number.
 *
 * The carrier is replaced by a recorder, as in `call-lifecycle.test.ts`: what is proved is the
 * database and the domain. Nothing here rings a telephone.
 */

const carrier = vi.hoisted(() => ({ rung: [] as { from: string; to: string }[] }));
vi.mock('@/lib/adapters/telephony', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/adapters/telephony')>()),
  callbackBase: () => 'https://callbacks.example.test',
  telephonyProvider: async () => ({
    addToRoom: async (input: { room: string; from: string; to: string }) => {
      carrier.rung.push({ from: input.from, to: input.to });
      return { externalId: `CA${crypto.randomUUID().replace(/-/g, '')}`, status: 'ringing' as const };
    },
    browserToken: async () => 'token',
    updateParticipant: async () => undefined,
    fetchRecording: async () => ({ body: new Response('audio').body!, contentType: 'audio/mpeg' }),
  }),
}));

// Whether a plan includes outbound calling is proved in `catalogue-plans.test.ts`. Here every
// business is taken to have it, so the readiness reasons after that one can be reached.
vi.mock('@/lib/domain/catalogue/organization-plans', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/domain/catalogue/organization-plans')>();
  return { ...original, availableFeatureKeys: (...args: Parameters<typeof original.availableFeatureKeys>) => new Set([...original.availableFeatureKeys(...args), 'outbound_calling']) };
});

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; membershipId: string };
type Tenant = Person & { organizationId: string };
type SeededNumber = { id: string; e164: string; resourceId: string };

let pg: Client;
let staff: SupabaseClient;
const client = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const phone = () => `+1416${Math.floor(2000000 + Math.random() * 7999999)}`;
const db = (person: Person) => person.db as never;

async function newTenant(label: string): Promise<Tenant> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const owner = client();
  const session = await owner.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;
  // A currency nothing prices, so opening a call never waits on credit.
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });
  return { db: owner, organizationId, membershipId: (await currentMembershipId(owner as never, { organizationId }))! };
}

/**
 * The callers here ring numbers that belong to no contact, so they hold manual dialing as well as
 * placing calls. Which numbers a caller without it may ring is `call-list-workflow.test.ts`'s.
 */
const DIALS_ANY_NUMBER = ['call.place', 'call.dial_manual'];

/** Another member of the business with exactly these capabilities, signed in after the membership exists. */
async function colleague(tenant: Tenant, capabilities: string[]): Promise<Person> {
  const email = `colleague-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const roleId = await createRole(db(tenant), { organizationId: tenant.organizationId, name: `Role ${randomUUID().slice(0, 8)}`, capabilities });
  await addMember(db(tenant), { organizationId: tenant.organizationId, email, displayName: 'Colleague', roleId });
  const signedIn = client();
  const session = await signedIn.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;
  return { db: signedIn, membershipId: (await currentMembershipId(signedIn as never, { organizationId: tenant.organizationId }))! };
}

/** A real provisioned number in an active calling account, through the one staff door that creates one. */
async function seedNumber(tenant: Tenant, e164 = phone()): Promise<SeededNumber> {
  await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
  await setProviderBindingStatus(staff, { organizationId: tenant.organizationId, providerKey: 'twilio', status: 'active', externalAccountId: `AC${tenant.organizationId.replace(/-/g, '')}` });
  const resourceId = await recordProviderResource(staff, { organizationId: tenant.organizationId, providerKey: 'twilio', resourceType: 'twilio_phone_number', externalId: `PN${randomUUID().replace(/-/g, '').slice(0, 32)}` });
  const { data, error } = await staff.rpc('sync_phone_number', { p_organization_id: tenant.organizationId, p_provider_resource_id: resourceId, p_e164: e164 });
  if (error) throw error;
  return { id: data as string, e164, resourceId };
}

const options = (person: Person, tenant: Tenant) => listOutboundNumberOptions(db(person), { organizationId: tenant.organizationId });
const resolve = (person: Person, tenant: Tenant, phoneNumberId?: string) => resolveOutboundNumber(db(person), { organizationId: tenant.organizationId, phoneNumberId });
const assign = (tenant: Tenant, number: SeededNumber, member: Person, isDefault = false) => assignPhoneNumber(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: number.id, memberId: member.membershipId, isDefault });
const share = (tenant: Tenant, number: SeededNumber, shared = true) => setOutboundSharing(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: number.id, shared });
const place = (person: Person, tenant: Tenant, phoneNumberId?: string) => placeCall(db(person), { organizationId: tenant.organizationId, toNumber: phone(), phoneNumberId });
const release = async (tenant: Tenant, number: SeededNumber, member: Person) => {
  const held = (await listPhoneNumberAssignments(db(tenant), { organizationId: tenant.organizationId })).find(entry => entry.phoneNumberId === number.id && entry.memberId === member.membershipId)!;
  await releasePhoneNumberAssignment(db(tenant), { organizationId: tenant.organizationId, assignmentId: held.id });
};

beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();
}, 60_000);
afterAll(async () => { await pg?.end(); });
beforeEach(() => { carrier.rung.length = 0; });

describe('Automatic', () => {
  it('uses the one number assigned to a person, and says it was selected from their assigned numbers', async () => {
    const tenant = await newTenant('auto-one');
    const number = await seedNumber(tenant);
    await assign(tenant, number, tenant);
    expect(await options(tenant, tenant)).toEqual([{ phoneNumberId: number.id, e164: number.e164, label: null, source: 'member', automatic: true }]);
    expect(await resolve(tenant, tenant)).toEqual({ phoneNumberId: number.id, e164: number.e164, source: 'member' });
    const call = await place(tenant, tenant);
    expect(call.fromNumber).toBe(number.e164);
    expect(carrier.rung).toMatchObject([{ from: number.e164 }]);
  });

  it('chooses the same way every time among several: preference, default, assigned, the business’s default, then shared', async () => {
    const tenant = await newTenant('auto-many');
    const [assigned, byDefault, preferred, business, pooled] = await Promise.all([seedNumber(tenant), seedNumber(tenant), seedNumber(tenant), seedNumber(tenant), seedNumber(tenant)]);
    const automatic = async () => (await options(tenant, tenant)).find(option => option.automatic);

    await share(tenant, pooled);
    expect(await automatic()).toMatchObject({ phoneNumberId: pooled.id, source: 'shared' });
    await setCallingNumber(db(tenant), { organizationId: tenant.organizationId, number: business.e164 });
    expect(await automatic()).toMatchObject({ phoneNumberId: business.id, source: 'organization_default' });
    await assign(tenant, assigned, tenant);
    expect(await automatic()).toMatchObject({ phoneNumberId: assigned.id, source: 'member' });
    await assign(tenant, byDefault, tenant, true);
    expect(await automatic()).toMatchObject({ phoneNumberId: byDefault.id, source: 'member_default' });
    await assign(tenant, preferred, tenant);
    await setOutboundPreference(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: preferred.id });
    expect(await automatic()).toMatchObject({ phoneNumberId: preferred.id, source: 'preference' });

    // Each number once, under the best reason, in the resolver's order; asked twice, answered the same.
    const listed = await options(tenant, tenant);
    expect(listed.map(option => [option.phoneNumberId, option.source, option.automatic])).toEqual([
      [preferred.id, 'preference', true], [byDefault.id, 'member_default', false], [assigned.id, 'member', false],
      [business.id, 'organization_default', false], [pooled.id, 'shared', false],
    ]);
    expect(await options(tenant, tenant)).toEqual(listed);
    // What a screen is told Automatic is, is what a call with nothing named is placed from.
    expect(await resolve(tenant, tenant)).toMatchObject({ phoneNumberId: preferred.id, source: 'preference' });
    expect((await place(tenant, tenant)).fromNumber).toBe(preferred.e164);
  });

  it('refuses when nothing is eligible, and never substitutes a number the person may not use', async () => {
    const tenant = await newTenant('auto-none');
    const unassigned = await seedNumber(tenant);
    expect(await options(tenant, tenant)).toEqual([]);
    expect(await resolve(tenant, tenant)).toBeNull();
    await expect(place(tenant, tenant)).rejects.toMatchObject({ code: 'calls.no_calling_number', message: 'No outbound number is assigned to you or shared in this business.' });
    expect(carrier.rung).toEqual([]);
    expect((await pg.query('select count(*)::int as n from public.calls where organization_id = $1', [tenant.organizationId])).rows[0].n).toBe(0);
    // The business does hold a ready number; it is simply nobody's to call from.
    expect((await listPhoneNumbers(db(tenant), { organizationId: tenant.organizationId })).map(number => [number.id, number.readiness])).toEqual([[unassigned.id, 'ready']]);
  });
});

describe('choosing a number', () => {
  let tenant: Tenant;
  let caller: Person;
  let own: SeededNumber, second: SeededNumber, colleagues: SeededNumber, pooled: SeededNumber;

  beforeAll(async () => {
    tenant = await newTenant('choose');
    caller = await colleague(tenant, DIALS_ANY_NUMBER);
    [own, second, colleagues, pooled] = await Promise.all([seedNumber(tenant), seedNumber(tenant), seedNumber(tenant), seedNumber(tenant)]);
    await assign(tenant, own, caller, true);
    await assign(tenant, second, caller);
    await assign(tenant, colleagues, tenant);
    await share(tenant, pooled);
  }, 90_000);

  it('offers a person their own numbers and the shared ones, and not a number assigned only to someone else', async () => {
    expect((await options(caller, tenant)).map(option => [option.phoneNumberId, option.source])).toEqual([[own.id, 'member_default'], [second.id, 'member'], [pooled.id, 'shared']]);
  });

  it('places a call from an explicitly chosen assigned number, and from a chosen shared one', async () => {
    expect((await place(caller, tenant, second.id)).fromNumber).toBe(second.e164);
    expect((await place(caller, tenant, pooled.id)).fromNumber).toBe(pooled.e164);
    expect(carrier.rung.map(entry => entry.from)).toEqual([second.e164, pooled.e164]);
  });

  it('records on the call the number it was placed from, which later changes do not rewrite', async () => {
    const call = await place(caller, tenant, pooled.id);
    await share(tenant, pooled, false);
    try {
      const { rows } = await pg.query('select from_number, phone_number_id from public.calls where id = $1', [call.callId]);
      expect(rows[0]).toEqual({ from_number: pooled.e164, phone_number_id: pooled.id });
    } finally { await share(tenant, pooled); }
  });

  it('refuses a number assigned only to a colleague, however the request names it, and rings nobody', async () => {
    expect(await resolve(caller, tenant, colleagues.id)).toBeNull();
    await expect(place(caller, tenant, colleagues.id)).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    expect(carrier.rung).toEqual([]);
  });

  it('refuses a number that does not exist, without falling back to Automatic', async () => {
    await expect(place(caller, tenant, randomUUID())).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    expect(carrier.rung).toEqual([]);
  });
});

describe('shared numbers', () => {
  it('are shared only by someone who manages the business, and only within it', async () => {
    const tenant = await newTenant('share-manage');
    const stranger = await newTenant('share-stranger');
    const caller = await colleague(tenant, DIALS_ANY_NUMBER);
    const number = await seedNumber(tenant);
    await expect(share({ ...tenant, db: caller.db }, number)).rejects.toMatchObject({ code: 'numbers.sharing_failed', message: 'Your role cannot change who may call from this number.' });
    await expect(setOutboundSharing(db(stranger), { organizationId: tenant.organizationId, phoneNumberId: number.id, shared: true })).rejects.toMatchObject({ code: 'numbers.sharing_failed' });
    // Naming their own business with another business's number changes nothing either.
    await expect(setOutboundSharing(db(stranger), { organizationId: stranger.organizationId, phoneNumberId: number.id, shared: true })).rejects.toMatchObject({ code: 'numbers.sharing_failed' });
    expect((await pg.query('select outbound_shared from public.phone_numbers where id = $1', [number.id])).rows[0].outbound_shared).toBe(false);
    // No direct write reaches the column: sharing goes through the one checked door.
    const direct = await tenant.db.from('phone_numbers').update({ outbound_shared: true }).eq('id', number.id).select('id');
    expect(direct.data ?? []).toEqual([]);
    expect((await pg.query('select outbound_shared from public.phone_numbers where id = $1', [number.id])).rows[0].outbound_shared).toBe(false);

    await share(tenant, number);
    expect((await pg.query(`select action, payload from public.events where entity_id = $1 and action = 'phone_number.sharing_changed'`, [number.id])).rows).toEqual([{ action: 'phone_number.sharing_changed', payload: { shared: true } }]);
  });

  it('are open to members who may place calls, and to nobody who may not', async () => {
    const tenant = await newTenant('share-who');
    const caller = await colleague(tenant, DIALS_ANY_NUMBER);
    const viewer = await colleague(tenant, []);
    const number = await seedNumber(tenant);
    await share(tenant, number);
    expect(await options(caller, tenant)).toMatchObject([{ phoneNumberId: number.id, source: 'shared', automatic: true }]);
    expect((await place(caller, tenant)).fromNumber).toBe(number.e164);
    expect(await options(viewer, tenant)).toEqual([]);
    expect(await resolve(viewer, tenant, number.id)).toBeNull();
    await expect(place(viewer, tenant, number.id)).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    expect(carrier.rung).toHaveLength(1);
  });

  it('must still be active, switched on for calls and ready', async () => {
    const tenant = await newTenant('share-ready');
    const number = await seedNumber(tenant);
    await share(tenant, number);
    const offered = async () => (await options(tenant, tenant)).length;
    expect(await offered()).toBe(1);

    await pg.query(`update public.organization_provider_resources set status = 'failed' where id = $1`, [number.resourceId]);
    expect(await offered()).toBe(0);
    await expect(place(tenant, tenant, number.id)).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    await pg.query(`update public.organization_provider_resources set status = 'active' where id = $1`, [number.resourceId]);
    expect(await offered()).toBe(1);

    await configurePhoneNumber(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: number.id, label: 'Pool', purpose: 'sales', voiceInbound: true, voiceOutbound: false, smsInbound: true, smsOutbound: true });
    expect(await offered()).toBe(0);
    await configurePhoneNumber(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: number.id, label: 'Pool', purpose: 'sales', voiceInbound: true, voiceOutbound: true, smsInbound: true, smsOutbound: true });
    expect(await options(tenant, tenant)).toMatchObject([{ phoneNumberId: number.id, label: 'Pool', source: 'shared' }]);

    await pg.query(`update public.phone_numbers set lifecycle = 'inactive' where id = $1`, [number.id]);
    expect(await offered()).toBe(0);
    expect(carrier.rung).toEqual([]);
  });
});

describe('a selection made earlier stops working when the authority behind it ends', () => {
  it('refuses a released assignment at once, though the browser still names the number', async () => {
    const tenant = await newTenant('stale-release');
    const caller = await colleague(tenant, DIALS_ANY_NUMBER);
    const [kept, taken] = await Promise.all([seedNumber(tenant), seedNumber(tenant)]);
    await assign(tenant, kept, caller, true);
    await assign(tenant, taken, caller);
    expect((await place(caller, tenant, taken.id)).fromNumber).toBe(taken.e164);

    await release(tenant, taken, caller);
    await expect(place(caller, tenant, taken.id)).rejects.toMatchObject({ code: 'calls.no_calling_number', message: 'You can no longer call from that number. Choose another, or use Automatic.' });
    expect((await options(caller, tenant)).map(option => option.phoneNumberId)).toEqual([kept.id]);
    expect(carrier.rung).toHaveLength(1);
  });

  it('does not let a preference outlive the assignment it was made from', async () => {
    const tenant = await newTenant('stale-preference');
    const caller = await colleague(tenant, DIALS_ANY_NUMBER);
    const [fallback, preferred] = await Promise.all([seedNumber(tenant), seedNumber(tenant)]);
    await assign(tenant, fallback, caller, true);
    await assign(tenant, preferred, caller);
    await setOutboundPreference(db(caller), { organizationId: tenant.organizationId, phoneNumberId: preferred.id });
    expect(await resolve(caller, tenant)).toMatchObject({ phoneNumberId: preferred.id, source: 'preference' });

    await release(tenant, preferred, caller);
    expect(await resolve(caller, tenant)).toMatchObject({ phoneNumberId: fallback.id, source: 'member_default' });
    expect(await resolve(caller, tenant, preferred.id)).toBeNull();
    expect((await place(caller, tenant)).fromNumber).toBe(fallback.e164);
  });

  it('refuses a number at once when the business stops sharing it', async () => {
    const tenant = await newTenant('stale-share');
    const caller = await colleague(tenant, DIALS_ANY_NUMBER);
    const number = await seedNumber(tenant);
    await share(tenant, number);
    expect((await place(caller, tenant, number.id)).fromNumber).toBe(number.e164);
    await share(tenant, number, false);
    await expect(place(caller, tenant, number.id)).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    await expect(place(caller, tenant)).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    expect(carrier.rung).toHaveLength(1);
  });

  it('refuses a caller whose role stops placing calls, even from their own assigned number', async () => {
    const tenant = await newTenant('stale-role');
    const caller = await colleague(tenant, DIALS_ANY_NUMBER);
    const number = await seedNumber(tenant);
    await assign(tenant, number, caller, true);
    await place(caller, tenant);
    await pg.query(`update public.roles set capabilities = '{}' where id = (select role_id from public.memberships where id = $1)`, [caller.membershipId]);
    await expect(place(caller, tenant)).rejects.toMatchObject({ code: 'calls.open_failed' });
    expect(carrier.rung).toHaveLength(1);
  });
});

describe('another business', () => {
  it('is told nothing about this one’s numbers and can use none of them', async () => {
    const tenant = await newTenant('iso-mine');
    const stranger = await newTenant('iso-theirs');
    const [assigned, pooled, theirs] = await Promise.all([seedNumber(tenant), seedNumber(tenant), seedNumber(stranger)]);
    await assign(tenant, assigned, tenant, true);
    await share(tenant, pooled);
    await assign(stranger, theirs, stranger, true);

    // Asking about this business as a member of another answers nothing.
    expect(await listOutboundNumberOptions(db(stranger), { organizationId: tenant.organizationId })).toEqual([]);
    expect(await resolveOutboundNumber(db(stranger), { organizationId: tenant.organizationId })).toBeNull();
    for (const number of [assigned, pooled]) {
      expect(await resolveOutboundNumber(db(stranger), { organizationId: tenant.organizationId, phoneNumberId: number.id })).toBeNull();
      // Their own business does not hold these numbers either, shared or not.
      expect(await resolve(stranger, stranger, number.id)).toBeNull();
      await expect(place(stranger, stranger, number.id)).rejects.toMatchObject({ code: 'calls.no_calling_number' });
    }
    expect((await options(stranger, stranger)).map(option => option.phoneNumberId)).toEqual([theirs.id]);
    expect(carrier.rung).toEqual([]);
    // A business cannot hand its number to a member of another business.
    await expect(assignPhoneNumber(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: assigned.id, memberId: stranger.membershipId })).rejects.toBeDefined();
  });
});

describe('what the Dialer is told about calling readiness', () => {
  const load = (person: Person, tenant: Tenant, mayCall = true) => loadCallingOptions(db(person), { organizationId: tenant.organizationId, mayCall });

  it('names the exact number problem, and offers the same numbers a call would accept', async () => {
    const tenant = await newTenant('ready');
    // No calling account at all is said before anything about numbers.
    expect((await load(tenant, tenant)).blocker).toMatchObject({ kind: 'unavailable', code: 'no-calling-account' });

    const number = await seedNumber(tenant);
    const blocker = async () => (await load(tenant, tenant)).blocker;
    expect(await blocker()).toMatchObject({ kind: 'not-configured', code: 'no-eligible-number', setup: 'phone-numbers' });

    await pg.query(`update public.organization_provider_resources set status = 'pending' where id = $1`, [number.resourceId]);
    expect(await blocker()).toMatchObject({ kind: 'unavailable', code: 'numbers-not-ready', setup: 'phone-numbers' });
    await pg.query(`update public.organization_provider_resources set status = 'active' where id = $1`, [number.resourceId]);

    await configurePhoneNumber(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: number.id, label: '', purpose: 'general', voiceInbound: true, voiceOutbound: false, smsInbound: true, smsOutbound: true });
    expect(await blocker()).toMatchObject({ kind: 'not-configured', code: 'numbers-not-enabled', setup: 'phone-numbers' });
    await configurePhoneNumber(db(tenant), { organizationId: tenant.organizationId, phoneNumberId: number.id, label: 'Front desk', purpose: 'general', voiceInbound: true, voiceOutbound: true, smsInbound: true, smsOutbound: true });

    await share(tenant, number);
    const ready = await load(tenant, tenant);
    expect(ready.blocker).toBeNull();
    expect(ready.numbers).toEqual([{ id: number.id, e164: number.e164, label: 'Front desk', source: 'shared', group: 'shared' }]);
    expect(ready.defaultNumber).toEqual(ready.numbers[0]);

    for (const [status, code] of [['provisioning', 'calling-account-setting-up'], ['failed', 'calling-account-fault'], ['suspended', 'calling-account-suspended']] as const) {
      await pg.query(`update public.organization_provider_bindings set status = $2 where organization_id = $1`, [tenant.organizationId, status]);
      const result = await load(tenant, tenant);
      expect(result.blocker).toMatchObject({ kind: 'unavailable', code, setup: null });
      expect(result.numbers).toEqual([]);
    }
  });

  it('says a business with no numbers has none', async () => {
    const tenant = await newTenant('ready-none');
    await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
    await setProviderBindingStatus(staff, { organizationId: tenant.organizationId, providerKey: 'twilio', status: 'active', externalAccountId: `AC${tenant.organizationId.replace(/-/g, '')}` });
    expect((await load(tenant, tenant)).blocker).toMatchObject({ kind: 'not-configured', code: 'no-numbers', setup: 'phone-numbers' });
  });
});

describe('who a call is with', () => {
  let tenant: Tenant;
  let caller: Person;
  let company: string, person: string;

  beforeAll(async () => {
    tenant = await newTenant('contact');
    const number = await seedNumber(tenant);
    await share(tenant, number);
    caller = await colleague(tenant, DIALS_ANY_NUMBER);
    company = await createContact(db(tenant), { organizationId: tenant.organizationId, name: 'Northwind Supply', phone: phone(), contactType: 'company' });
    person = await createContact(db(tenant), { organizationId: tenant.organizationId, name: 'Zed Okafor', phone: phone(), email: 'zed@example.test', contactType: 'person', companyId: company, affiliationTitle: 'Purchasing lead' });
  }, 90_000);

  const callTo = async (who: Person, input: { customerId?: string; toNumber?: string }) =>
    (await placeCall(db(who), { organizationId: tenant.organizationId, toNumber: input.toNumber ?? phone(), customerId: input.customerId })).callId;

  it('is the contact the call is linked to, with their business from the affiliation, though they are on no call list', async () => {
    const callId = await callTo(caller, { customerId: person });
    // The caller may place calls and may not view contacts; the person is on no call list.
    expect((await caller.db.from('contacts').select('id').eq('id', person)).data ?? []).toEqual([]);
    expect(await callListContacts(db(caller), { organizationId: tenant.organizationId, customerIds: [person] })).toEqual([]);
    expect(await callContact(db(caller), { organizationId: tenant.organizationId, callId })).toMatchObject({
      id: person, name: 'Zed Okafor', email: 'zed@example.test', archived: false, contactType: 'person', companyId: company, companyName: 'Northwind Supply', title: 'Purchasing lead',
    });
  });

  it('gives a company itself as its business, taken from the recorded type and not from its name', async () => {
    const callId = await callTo(tenant, { customerId: company });
    expect(await callContact(db(tenant), { organizationId: tenant.organizationId, callId })).toMatchObject({ id: company, contactType: 'company', companyId: company, companyName: 'Northwind Supply', title: null });
    const plain = await createContact(db(tenant), { organizationId: tenant.organizationId, name: 'Acme Holdings Ltd', phone: phone() });
    const plainCall = await callTo(tenant, { customerId: plain });
    // A name that reads like a company is not one until it is recorded as one.
    expect(await callContact(db(tenant), { organizationId: tenant.organizationId, callId: plainCall })).toMatchObject({ contactType: 'unspecified', companyId: null, companyName: null });
  });

  it('names nobody for a number two contacts share, and never picks one of them', async () => {
    const sharedNumber = phone();
    const first = await createContact(db(tenant), { organizationId: tenant.organizationId, name: 'Front desk A', phone: sharedNumber });
    await createContact(db(tenant), { organizationId: tenant.organizationId, name: 'Front desk B', phone: sharedNumber });
    expect(await dialerContactCandidates(db(caller), { organizationId: tenant.organizationId, number: sharedNumber })).toHaveLength(2);
    const unlinked = await callTo(caller, { toNumber: sharedNumber });
    expect(await callContact(db(caller), { organizationId: tenant.organizationId, callId: unlinked })).toBeNull();
    // Said by the operator, the link is the call's own and is what is read back.
    const linked = await callTo(caller, { toNumber: sharedNumber, customerId: first });
    expect(await callContact(db(caller), { organizationId: tenant.organizationId, callId: linked })).toMatchObject({ id: first, name: 'Front desk A' });
  });

  it('is not disclosed to a member who may neither place calls nor view contacts, nor to another business', async () => {
    const callId = await callTo(caller, { customerId: person });
    const viewer = await colleague(tenant, []);
    const stranger = await newTenant('contact-stranger');
    await expect(callContact(db(viewer), { organizationId: tenant.organizationId, callId })).rejects.toBeDefined();
    await expect(callContact(db(stranger), { organizationId: tenant.organizationId, callId })).rejects.toBeDefined();
    // Naming their own business with this business's call answers nobody.
    expect(await callContact(db(stranger), { organizationId: stranger.organizationId, callId })).toBeNull();
    expect(await callContact(db(caller), { organizationId: tenant.organizationId, callId: randomUUID() })).toBeNull();
  });

  it('gives the call list and the typed-number match the same business context', async () => {
    await addToCallList(db(tenant), { organizationId: tenant.organizationId, target: { customerIds: [person] }, reason: 'Renewal' });
    expect(await callListContacts(db(caller), { organizationId: tenant.organizationId, customerIds: [person, company] })).toEqual([
      expect.objectContaining({ id: person, companyId: company, companyName: 'Northwind Supply', title: 'Purchasing lead', contactType: 'person' }),
    ]);
    const zed = (await pg.query('select phone from public.contacts where id = $1', [person])).rows[0].phone as string;
    expect(await dialerContactCandidates(db(caller), { organizationId: tenant.organizationId, number: zed })).toEqual([
      expect.objectContaining({ id: person, companyName: 'Northwind Supply', title: 'Purchasing lead' }),
    ]);
  });

  it('follows the primary active affiliation, and drops a business the person has left', async () => {
    const callId = await callTo(caller, { customerId: person });
    await pg.query('update public.contact_affiliations set active = false where person_id = $1', [person]);
    try {
      expect(await callContact(db(caller), { organizationId: tenant.organizationId, callId })).toMatchObject({ id: person, companyId: null, companyName: null, title: null });
    } finally { await pg.query('update public.contact_affiliations set active = true where person_id = $1', [person]); }
  });
});
