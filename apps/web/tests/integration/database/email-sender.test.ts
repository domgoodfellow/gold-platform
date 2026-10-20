import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addAutomationAction, createAutomationRule } from '@/lib/domain/automation/rules';
import { createMessageTemplate } from '@/lib/domain/automation/templates';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createEmailIdentity } from '@/lib/domain/email/identities';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';
import { readyEmailSender, type ReadySender } from '@/tests/support/email-sender';

/**
 * One organization sender for every email a business sends (Phase 3A).
 *
 * GildOps holds the provider account; a business owns the addresses it has proved. These cases hold
 * the database to that: a business's email is queued and sent only from its own ready address,
 * through the account that holds that address's domain, never from another business's address and
 * never from an installation-wide one; a missing or unverified sender refuses with a reason the
 * business can act on and never undoes the booking or change that asked for the email; and each
 * delivery is claimed once, so two runners cannot both send it.
 *
 * Disposable local businesses only. Nothing here reaches a provider.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BOOKED = 'work_item.booked';

type Business = { db: SupabaseClient; userId: string; organizationId: string; statusId: string; customerId: string; ruleId: string };

let pg: Client;
let a: Business;
let b: Business;

async function owner(label: string): Promise<{ db: SupabaseClient; email: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { db, email, userId: made.data.user.id };
}

/** A business with one booking confirmation rule: on a booking, email the customer. */
async function business(label: string): Promise<Business> {
  const person = await owner(label);
  const organizationId = await foundBusiness({ ownerEmail: person.email, name: `${label} Ltd`, displayName: 'Founder', timezone: 'UTC', currency: 'EUR' });
  await setModuleEnabled(person.db, { organizationId, key: 'automations', enabled: true });
  const typeId = await createWorkItemType(person.db, { schedulable: true, organizationId, name: 'Visit' });
  const statusId = await createWorkItemStatus(person.db, { organizationId, typeId, name: 'Booked', position: 0 });
  const customerId = await createCustomer(person.db, { organizationId, name: 'Ana', email: `ana-${randomUUID().slice(0, 8)}@example.test` });
  const templateId = await createMessageTemplate(person.db, { organizationId, name: 'Booking confirmation', subject: 'Booked with {{business}}', body: 'Hello {{customer}}, {{job}} is booked.' });
  const ruleId = await createAutomationRule(person.db, { organizationId, name: 'Confirm bookings', triggerKind: 'event', triggerEventAction: BOOKED });
  await addAutomationAction(person.db, { organizationId, ruleId, kind: 'notify', templateId, channel: 'email' });
  return { db: person.db, userId: person.userId, organizationId, statusId, customerId, ruleId };
}

/**
 * A booking, as `create_booking` records it: the job, then its `work_item.booked` event in the same
 * transaction. The event is what a booking confirmation rule runs on; committing is the booking.
 */
async function book(of: Business): Promise<string> {
  const workItemId = await createWorkItem(of.db, { organizationId: of.organizationId, statusId: of.statusId, title: `Visit ${randomUUID().slice(0, 6)}`, customerId: of.customerId });
  await pg.query('begin');
  try {
    await pg.query("insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values($1,$2,'work_item',$3,$4,'{}')", [of.organizationId, of.userId, workItemId, BOOKED]);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
  return workItemId;
}

/** One call as a machine role, in its own transaction, the way the runtimes reach the database. */
async function as<T = Record<string, unknown>>(role: string, sql: string, values: unknown[] = []): Promise<T[]> {
  await pg.query('begin');
  try {
    await pg.query(`set local role ${role}`);
    const result = await pg.query(sql, values);
    await pg.query('commit');
    return result.rows as T[];
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

type Claimed = { id: string; channel: string; from_address: string | null; from_name: string | null; provider_key: string | null; provider_account_id: string | null };
const claim = () => as<Claimed>('automation_runner', 'select * from public.claim_message_deliveries(200)');
const finish = (id: string, outcome: string, externalId: string | null = null, detail: string | null = null) =>
  as('automation_runner', 'select public.finish_message_delivery($1,$2,$3,$4)', [id, outcome, externalId, detail]);
const delivery = async (subjectId: string) =>
  (await pg.query('select id,state,detail,email_identity_id,external_id,claimed_at from public.message_deliveries where subject_id=$1', [subjectId])).rows[0];
const runOf = async (subjectId: string) =>
  (await pg.query('select outcome,detail from public.automation_runs where subject_id=$1 order by occurred_at desc limit 1', [subjectId])).rows[0];
const status = async (of: Business, db = of.db) => {
  const { data, error } = await db.rpc('organization_email_sender_status' as never, { p_organization_id: of.organizationId } as never);
  if (error) throw error;
  return (data as { state: string; address: string | null; detail: string | null }[])[0];
};

beforeAll(async () => {
  if (![SUPABASE_URL, CONNECTION].every((value) => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname))) throw new Error('Disposable local fixtures only');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  a = await business('sender-a');
  b = await business('sender-b');
}, 120_000);
afterAll(async () => { await pg?.end(); });

describe('a business with no ready sender', () => {
  it('queues no booking confirmation, says why, and keeps the booking', async () => {
    expect(await status(a)).toMatchObject({ state: 'missing' });
    const booking = await book(a);
    expect(await delivery(booking)).toBeUndefined();
    const run = await runOf(booking);
    expect(run.outcome).toBe('failed');
    expect(run.detail).toContain('no default sender address');
    // The booking stands: the job and its booking event were committed.
    expect((await pg.query("select count(*)::int n from public.events where entity_id=$1 and action=$2", [booking, BOOKED])).rows[0].n).toBe(1);
    expect((await pg.query('select count(*)::int n from public.work_items where id=$1', [booking])).rows[0].n).toBe(1);
  });

  it('cannot make an unverified address its default', async () => {
    const domainName = `unverified-${randomUUID().slice(0, 8)}.example.test`;
    const named = await a.db.rpc('record_organization_email_domain', { p_organization_id: a.organizationId, p_domain: domainName });
    if (named.error) throw named.error;
    const unverified = await createEmailIdentity(a.db, { organizationId: a.organizationId, address: `hello@${domainName}`, sendingDomainResourceId: named.data as string });
    const set = await a.db.rpc('set_default_email_sender', { p_organization_id: a.organizationId, p_email_identity_id: unverified.id });
    expect(set.error?.code).toBe('55000');
    expect(set.error?.message).toContain('is not verified for sending');
    expect(await status(a)).toMatchObject({ state: 'missing' });
  });
});

describe('the default sender', () => {
  let sender: ReadySender;
  let other: ReadySender;

  beforeAll(async () => {
    sender = await readyEmailSender(pg, a.db, a.organizationId);
    other = await readyEmailSender(pg, b.db, b.organizationId);
  });

  it('is never another business’s address, and only this business’s managers may choose it', async () => {
    const foreign = await a.db.rpc('set_default_email_sender', { p_organization_id: a.organizationId, p_email_identity_id: other.identityId });
    expect(foreign.error?.code).toBe('42501');
    const stranger = await b.db.rpc('set_default_email_sender', { p_organization_id: a.organizationId, p_email_identity_id: other.identityId });
    expect(stranger.error?.code).toBe('42501');
    await expect(status(a, b.db)).rejects.toMatchObject({ code: '42501' });
    expect(await status(a)).toMatchObject({ state: 'ready', address: sender.address });
    // Members read the setting through their own business only.
    expect((await b.db.from('organization_email_sending').select('organization_id').eq('organization_id', a.organizationId)).data).toEqual([]);
  });

  it('pins a booking confirmation to the business’s own sender when it is queued', async () => {
    const booking = await book(a);
    expect(await delivery(booking)).toMatchObject({ state: 'queued', email_identity_id: sender.identityId });
  });

  it('is claimed once, with the sender and the account that holds its domain, and never twice', async () => {
    const booking = await book(a);
    const { id } = await delivery(booking);
    const first = (await claim()).find((row) => row.id === id);
    expect(first).toMatchObject({ channel: 'email', from_address: sender.address, provider_key: 'resend', provider_account_id: sender.accountId });
    expect((await claim()).some((row) => row.id === id)).toBe(false);
    expect(await delivery(booking)).toMatchObject({ state: 'sending' });

    const providerId = `re_${randomUUID()}`;
    await finish(id, 'accepted', providerId);
    expect(await delivery(booking)).toMatchObject({ state: 'sent', external_id: providerId, claimed_at: null });
    // A late or repeated answer changes nothing once it is finished.
    await finish(id, 'rejected', null, 'too late');
    expect(await delivery(booking)).toMatchObject({ state: 'sent', detail: null });
  });

  it('returns a transient fault to the queue and records a provider refusal with its reason', async () => {
    const booking = await book(a);
    const { id } = await delivery(booking);
    expect((await claim()).some((row) => row.id === id)).toBe(true);
    await finish(id, 'retry');
    expect(await delivery(booking)).toMatchObject({ state: 'queued', claimed_at: null });

    expect((await claim()).some((row) => row.id === id)).toBe(true);
    await finish(id, 'rejected', null, 'The domain is not verified at the provider');
    expect(await delivery(booking)).toMatchObject({ state: 'failed', detail: 'The domain is not verified at the provider' });
  });

  it('fails a queued email whose sender stopped being ready, instead of sending it', async () => {
    const booking = await book(a);
    await pg.query("update public.email_identities set status='disabled' where id=$1", [sender.identityId]);
    try {
      const { id } = await delivery(booking);
      expect((await claim()).some((row) => row.id === id)).toBe(false);
      const after = await delivery(booking);
      expect(after.state).toBe('failed');
      expect(after.detail).toContain('is not verified for sending');
    } finally {
      await pg.query("update public.email_identities set status='active' where id=$1", [sender.identityId]);
    }
  });

  it('keeps an email queued while the platform account holding its domain is unavailable', async () => {
    const booking = await book(a);
    await pg.query("update public.platform_provider_accounts set status='disabled' where id=$1", [sender.accountId]);
    try {
      const { id } = await delivery(booking);
      expect((await claim()).some((row) => row.id === id)).toBe(false);
      expect(await delivery(booking)).toMatchObject({ state: 'queued' });
      expect(await status(a)).toMatchObject({ state: 'unavailable' });
    } finally {
      await pg.query("update public.platform_provider_accounts set status='active' where id=$1", [sender.accountId]);
    }
    const { id } = await delivery(booking);
    expect((await claim()).some((row) => row.id === id)).toBe(true);
    await finish(id, 'accepted', `re_${randomUUID()}`);
  });

  it('sends an interrupted email again under the same id, and fails an interrupted text as uncertain', async () => {
    const booking = await book(a);
    const { id } = await delivery(booking);
    expect((await claim()).some((row) => row.id === id)).toBe(true);
    await pg.query("update public.message_deliveries set claimed_at=now()-interval '11 minutes' where id=$1", [id]);
    expect((await claim()).find((row) => row.id === id)).toMatchObject({ from_address: sender.address });
    await finish(id, 'accepted', `re_${randomUUID()}`);

    const text = (await pg.query(
      "insert into public.message_deliveries(organization_id,rule_id,rule_name,subject_type,subject_id,channel,recipient,body,state,claimed_at) values($1,$2,'Text',$3,$4,'sms','+14165550100','Hi','sending',now()-interval '11 minutes') returning id",
      [a.organizationId, a.ruleId, 'work_item', randomUUID()],
    )).rows[0].id;
    expect((await claim()).some((row) => row.id === text)).toBe(false);
    const after = (await pg.query('select state,detail from public.message_deliveries where id=$1', [text])).rows[0];
    expect(after.state).toBe('failed');
    expect(after.detail).toContain('Delivery uncertain');
  });

  it('uses a customer’s own ready sender over the default, and refuses one that is not ready', async () => {
    const chosen = (rows: { value: string }[]) => rows[0].value;
    expect(chosen((await pg.query('select app.customer_email_sender($1,$2) value', [a.organizationId, a.customerId])).rows)).toBe(sender.identityId);
    const second = await readyEmailSender(pg, a.db, a.organizationId, { makeDefault: false });
    const set = await a.db.rpc('set_customer_notification_sender', { p_organization_id: a.organizationId, p_customer_id: a.customerId, p_email_identity_id: second.identityId });
    expect(set.error).toBeNull();
    expect(chosen((await pg.query('select app.customer_email_sender($1,$2) value', [a.organizationId, a.customerId])).rows)).toBe(second.identityId);

    const foreign = await a.db.rpc('set_customer_notification_sender', { p_organization_id: a.organizationId, p_customer_id: a.customerId, p_email_identity_id: other.identityId });
    expect(foreign.error).not.toBeNull();
    await pg.query("update public.email_identities set status='disabled' where id=$1", [second.identityId]);
    const unready = await a.db.rpc('set_customer_notification_sender', { p_organization_id: a.organizationId, p_customer_id: a.customerId, p_email_identity_id: second.identityId });
    expect(unready.error?.code).toBe('55000');
  });

  it('answers the provider runtime about one address, and nobody else', async () => {
    const ask = (identity: string) => as<{ state: string; provider_account_id: string | null; detail: string | null }>('provider_operator', 'select * from public.email_sender_account($1,$2)', [a.organizationId, identity]);
    expect((await ask(sender.identityId))[0]).toMatchObject({ state: 'ready', provider_account_id: sender.accountId });
    expect((await ask(other.identityId))[0]).toMatchObject({ state: 'refused', provider_account_id: null });
    const member = await a.db.rpc('email_sender_account' as never, { p_organization_id: a.organizationId, p_email_identity_id: sender.identityId } as never);
    expect(member.error).not.toBeNull();
    const runner = await a.db.rpc('claim_message_deliveries' as never, { p_limit: 1 } as never);
    expect(runner.error).not.toBeNull();
  });
});

describe('which provider account holds a domain (Phase 3B)', () => {
  it('refuses a verified domain whose account was never recorded, until the domain is confirmed again', async () => {
    const c = await business('sender-provenance');
    const domainName = `unrecorded-${randomUUID().slice(0, 8)}.example.test`;
    const named = await c.db.rpc('record_organization_email_domain', { p_organization_id: c.organizationId, p_domain: domainName });
    if (named.error) throw named.error;
    const identity = await createEmailIdentity(c.db, { organizationId: c.organizationId, address: `hello@${domainName}`, sendingDomainResourceId: named.data as string });
    // Verified, as a domain made before accounts were recorded is, with no account on its binding.
    await pg.query("select record_email_domain_provisioning($1,$2,'active')", [c.organizationId, named.data]);
    // Another platform account exists, and is never used in place of the unrecorded one.
    const other = (await pg.query("insert into platform_provider_accounts(provider_key,label,credential_kind,credential_identifier,credential_set_at) values('resend',$1,'api_key','fixture-key',now()) returning id", [`Unused ${randomUUID().slice(0, 8)}`])).rows[0].id;

    const refused = await c.db.rpc('set_default_email_sender', { p_organization_id: c.organizationId, p_email_identity_id: identity.id });
    expect(refused.error?.code).toBe('55000');
    expect(refused.error?.message).toContain('has not yet confirmed which email account holds the domain');
    const listed = await c.db.rpc('organization_email_senders', { p_organization_id: c.organizationId });
    expect(listed.data?.[0]).toMatchObject({ state: 'not_ready', is_default: false });

    // Confirming the domain through an account records that account, and only fills an empty binding.
    const account = (await pg.query("insert into platform_provider_accounts(provider_key,label,credential_kind,credential_identifier,credential_set_at) values('resend',$1,'api_key','fixture-key',now()) returning id", [`Confirmed ${randomUUID().slice(0, 8)}`])).rows[0].id;
    await as('provider_operator', "select public.record_email_domain_provisioning($1,$2,'active',p_provider_account_id=>$3)", [c.organizationId, named.data, account]);
    await expect(as('provider_operator', "select public.record_email_domain_provisioning($1,$2,'active',p_provider_account_id=>$3)", [c.organizationId, named.data, other])).rejects.toThrow('held by a different provider account');

    const accepted = await c.db.rpc('set_default_email_sender', { p_organization_id: c.organizationId, p_email_identity_id: identity.id });
    expect(accepted.error).toBeNull();
    const ask = await as<{ state: string; provider_account_id: string }>('provider_operator', 'select * from public.email_sender_account($1,$2)', [c.organizationId, identity.id]);
    expect(ask[0]).toMatchObject({ state: 'ready', provider_account_id: account });
    // Nobody outside the business reads its senders.
    expect((await b.db.rpc('organization_email_senders', { p_organization_id: c.organizationId })).error?.code).toBe('42501');
  });
});

describe('the runtime being replaced (staged rollout)', () => {
  it('hands the old runner text messages only, through the same single claim, and finishes them', async () => {
    const booking = await book(a);
    const email = await delivery(booking);
    const text = (await pg.query(
      "insert into public.message_deliveries(organization_id,rule_id,rule_name,subject_type,subject_id,channel,recipient,body) values($1,$2,'Text','work_item',$3,'sms','+14165550101','Hi') returning id",
      [a.organizationId, a.ruleId, randomUUID()],
    )).rows[0].id;
    const old = await as<{ id: string; channel: string }>('automation_runner', 'select * from public.queued_messages(200)');
    expect(old.some((row) => row.id === email.id)).toBe(false);
    expect(old.find((row) => row.id === text)).toMatchObject({ channel: 'sms' });
    // The email is still waiting for the runtime that sends it from the business's own sender.
    expect((await delivery(booking)).state).toBe('queued');
    // The text is taken once: the new runner takes the email but not the text the old one holds.
    const claimed = await claim();
    expect(claimed.some((row) => row.id === email.id)).toBe(true);
    expect(claimed.some((row) => row.id === text)).toBe(false);
    await finish(email.id, 'accepted', `re_${randomUUID()}`);
    await as('automation_runner', 'select public.record_message_delivery($1,true,null)', [text]);
    expect((await pg.query('select state from public.message_deliveries where id=$1', [text])).rows[0].state).toBe('sent');
  });
});

describe('retries and what the provider later says', () => {
  let identityId: string;
  beforeAll(async () => {
    identityId = (await pg.query('select default_email_identity_id id from public.organization_email_sending where organization_id=$1', [a.organizationId])).rows[0].id;
  });

  it('sends every retry with the From the first attempt used, even after the address is renamed', async () => {
    const booking = await book(a);
    const { id } = await delivery(booking);
    const first = (await claim()).find((row) => row.id === id)!;
    await finish(id, 'retry');
    await pg.query("update public.email_identities set display_name='Renamed' where id=$1", [identityId]);
    try {
      const second = (await claim()).find((row) => row.id === id)!;
      expect(second.from_address).toBe(first.from_address);
      expect(second.from_name).toBe(first.from_name);
      expect((await pg.query('select attempts from public.message_deliveries where id=$1', [id])).rows[0].attempts).toBe(2);
      await finish(id, 'accepted', `re_${randomUUID()}`);
    } finally {
      await pg.query('update public.email_identities set display_name=null where id=$1', [identityId]);
    }
  });

  it('never attempts again once the provider no longer remembers the first attempt’s key', async () => {
    const booking = await book(a);
    const { id } = await delivery(booking);
    expect((await claim()).some((row) => row.id === id)).toBe(true);
    await finish(id, 'retry');
    await pg.query("update public.message_deliveries set first_attempt_at=now()-interval '24 hours' where id=$1", [id]);
    expect((await claim()).some((row) => row.id === id)).toBe(false);
    const after = await delivery(booking);
    expect(after.state).toBe('failed');
    expect(after.detail).toContain('Delivery uncertain');
  });

  it('records an uncertain answer as uncertain, never as refused or retried', async () => {
    const booking = await book(a);
    const { id } = await delivery(booking);
    expect((await claim()).some((row) => row.id === id)).toBe(true);
    await finish(id, 'uncertain', null, 'the idempotency key was already used for a different request');
    const after = await delivery(booking);
    expect(after.state).toBe('failed');
    expect(after.detail).toMatch(/^Delivery uncertain: the idempotency key was already used/);
  });

  it('matches delivery reports, including early ones, and never lets a late delay undo a final report', async () => {
    const report = (provider: string, kind: string, at: string) =>
      as('tenant_email_webhook', `select public.record_email_event($1,$2,$3,null,'{}',${at})`, [provider, kind, `evt_${randomUUID()}`]);
    const state = async (id: string) => (await pg.query('select provider_state from public.message_deliveries where id=$1', [id])).rows[0].provider_state;

    // A report that arrives before the acceptance is recorded is held, then applied.
    const early = await book(a);
    const { id: earlyId } = await delivery(early);
    const earlyProvider = `re_${randomUUID()}`;
    expect((await claim()).some((row) => row.id === earlyId)).toBe(true);
    await report(earlyProvider, 'delivered', "now()-interval '1 minute'");
    await finish(earlyId, 'accepted', earlyProvider);
    expect(await state(earlyId)).toBe('delivered');

    // After acceptance: delivered, then a late delay that must not replace it, then a bounce that does.
    const later = await book(a);
    const { id } = await delivery(later);
    const provider = `re_${randomUUID()}`;
    expect((await claim()).some((row) => row.id === id)).toBe(true);
    await finish(id, 'accepted', provider);
    expect(await state(id)).toBeNull();
    await report(provider, 'delivered', "now()-interval '2 minutes'");
    await report(provider, 'delayed', "now()-interval '5 minutes'");
    expect(await state(id)).toBe('delivered');
    await report(provider, 'opened', 'now()');
    expect(await state(id)).toBe('delivered');
    await report(provider, 'bounced', 'now()');
    expect(await state(id)).toBe('bounced');
  });
});
