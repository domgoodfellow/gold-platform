import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, Db } from '@/lib/db/types';
import { foundBusiness } from '@/tests/support/founding';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createServiceEngagement } from '@/lib/domain/customers/service-engagements';
import { saveServiceDisclosure, releaseServiceDisclosure, disclosureEditorState } from '@/lib/domain/customers/service-disclosures';
import { releaseServiceReview, withdrawServiceReview } from '@/lib/domain/customers/service-reviews';
import { createPortalInvite, exchangePortalLink } from '@/lib/domain/portal/portal';
import { createEmailIdentity } from '@/lib/domain/email/identities';
import { notificationConfiguration, notificationHistory } from '@/lib/domain/customers/service-notifications';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const connection = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const client = () => createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
let pg: Client; let operator: Db; let portal: Db; let otherPortal: Db; let outsider: Db;
let org: string; let customer: string; let otherCustomer: string; let identity: string; let domain: string;
async function rpc(db: Db, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(name as never, args as never); if (error) throw new Error(error.message); return data;
}
async function machine(name: string, args: unknown[] = []) {
  await pg.query('begin');
  try {
    await pg.query('set local role customer_notification_worker');
    const value = (await pg.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args)).rows[0].value;
    await pg.query('commit'); return value;
  } catch (error) { await pg.query('rollback'); throw error; }
}
async function propose(address = `recipient-${randomUUID()}@example.test`) {
  await pg.query("update app.notification_challenges set created_at=now()-interval '2 hours' where organization_id=$1", [org]);
  const id = await rpc(portal, 'propose_notification_recipient', { p_email_address: address, p_purposes: ['service_review_requested', 'service_update_published'] });
  const job = (await pg.query('select j.*,m.body from app.notification_jobs j join messages m on m.organization_id=j.organization_id and m.id=j.message_id where j.challenge_id=$1', [id])).rows[0];
  const code = job.body.match(/: ([a-f0-9]{16})/)[1];
  return { id, code, job, address };
}
async function consent() { const p = await propose(); expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: p.code })).toBe(true); return p; }
async function fixture(notify = true) {
  const engagement = await createServiceEngagement(operator, { organizationId: org, customerId: customer, name: 'Notification service', serviceKind: 'website' });
  await saveServiceDisclosure(operator, org, customer, engagement, 0, { title: 'Approved update', serviceKind: 'website', summary: 'Private material must stay in Portal', status: 'Ready', deliverables: [] });
  await releaseServiceDisclosure(operator, org, customer, engagement, 1, 'publish', notify);
  const revision = (await disclosureEditorState(operator, org, customer, engagement)).disclosure!.published_revision_id!;
  const review = await releaseServiceReview(operator, org, customer, engagement, revision, undefined, notify);
  return { engagement, revision, review };
}
async function claimReview(review: string) {
  const job = (await pg.query('select j.id from app.notification_jobs j join service_notification_intents i on i.organization_id=j.organization_id and i.id=j.intent_id where i.review_id=$1', [review])).rows[0];
  await pg.query('update app.notification_jobs set next_attempt_at=now() where id=$1', [job.id]);
  return machine('claim_customer_notification', [job.id]);
}
beforeAll(async () => {
  if (![url, connection].every(v => ['127.0.0.1', 'localhost'].includes(new URL(v).hostname))) throw new Error('Disposable local fixtures only');
  pg = new Client(connection); await pg.connect();
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  async function account() {
    const email = `notifications-${randomUUID()}@example.test`; const password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error) throw created.error;
    const db = client(); const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
    return { db, email };
  }
  const seller = await account(); operator = seller.db; const foreign = await account(); outsider = foreign.db;
  org = await foundBusiness({ ownerEmail: seller.email, name: 'Notification seller', currency: 'CAD' });
  await foundBusiness({ ownerEmail: foreign.email, name: 'Unrelated seller', currency: 'CAD' });
  customer = await createCustomer(operator, { organizationId: org, name: 'Business customer' });
  otherCustomer = await createCustomer(operator, { organizationId: org, name: 'Other customer' });
  await setModuleEnabled(operator, { organizationId: org, key: 'portal', enabled: true });
  await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:portal','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local notification fixture')", [org, (await operator.auth.getUser()).data.user!.id]);
  portal = client(); otherPortal = client();
  await exchangePortalLink(portal, { token: await createPortalInvite(operator, { customerId: customer }) });
  await exchangePortalLink(otherPortal, { token: await createPortalInvite(operator, { customerId: otherCustomer }) });
  const domainName = `notify-${randomUUID()}.example.test`;
  const named = await operator.rpc('record_organization_email_domain', { p_organization_id: org, p_domain: domainName }); if (named.error) throw named.error;
  domain = named.data;
  identity = (await createEmailIdentity(operator, { organizationId: org, address: `service@${domainName}`, sendingDomainResourceId: domain })).id;
  await pg.query("select record_email_domain_provisioning($1,$2,'active')", [org, domain]);
  await rpc(operator, 'set_customer_notification_sender', { p_organization_id: org, p_customer_id: customer, p_email_identity_id: identity });
}, 90_000);
afterAll(async () => { await pg?.end(); });

describe('customer notification consent, queue and evidence', () => {
  it('never infers consent from Portal access and keeps domain operations independent', async () => {
    const f = await fixture();
    const history = await notificationHistory(operator, org, customer, f.engagement);
    expect(history).toHaveLength(2); expect(history.every(n => n.state === 'suppressed')).toBe(true);
    expect((await pg.query('select state from service_reviews where id=$1', [f.review])).rows[0].state).toBe('pending');
    const unrequested = await fixture(false);
    expect((await notificationHistory(operator, org, customer, unrequested.engagement)).every(n => n.state === 'not_requested')).toBe(true);
  });
  it('confirms only a mailbox code under the original scoped Portal session and hides code readback', async () => {
    const p = await propose();
    for (const db of [operator, portal, outsider, otherPortal]) {
      expect((await db.from('messages').select('body').eq('id', p.job.message_id)).data).toEqual([]);
      expect((await db.from('email_message_details').select('*').eq('message_id', p.job.message_id)).data).toEqual([]);
    }
    expect(await rpc(otherPortal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: p.code })).toBe(false);
    expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: 'incorrect' })).toBe(false);
    expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: p.code })).toBe(true);
    expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: p.code })).toBe(false);
    await expect(rpc(operator, 'withdraw_notification_consent')).rejects.toThrow('Portal');
    expect((await outsider.from('customer_notification_recipients').select('*')).data).toEqual([]);
    expect((await portal.from('customer_notification_recipients').select('*')).data).toEqual([]);
    expect((await operator.from('customer_notification_recipients').update({ verified_at: new Date().toISOString() }).eq('customer_id', customer)).error).toBeTruthy();
    await expect(rpc(operator, 'claim_customer_notification')).rejects.toThrow('permission');
    await expect(rpc(outsider, 'set_customer_notification_sender', { p_organization_id: org, p_customer_id: customer, p_email_identity_id: identity })).rejects.toThrow('permission');
  });
  it('commits intent atomically, deduplicates releases and keeps a single canonical transactional message', async () => {
    await consent(); const f = await fixture();
    expect(await releaseServiceReview(operator, org, customer, f.engagement, f.revision, undefined, true)).toBe(f.review);
    const history = await notificationHistory(operator, org, customer, f.engagement);
    expect(history).toHaveLength(2); expect(history.every(n => n.state === 'queued')).toBe(true);
    const msg = (await pg.query('select m.*,d.from_address,d.to_addresses from messages m join email_message_details d on d.organization_id=m.organization_id and d.message_id=m.id where m.id=$1', [history[0].messageId])).rows[0];
    expect(msg.intent).toBe('transactional'); expect(msg.body).not.toContain('Private material'); expect(msg.body).not.toContain('token');
    expect((await pg.query('select claim_email_for_send($1,$2) value', [org, msg.id])).rows[0].value).toBe(false);
    await expect(releaseServiceReview(outsider, org, customer, f.engagement, f.revision, undefined, true)).rejects.toThrow('permission');
    const count = (await pg.query('select count(*) from service_notification_intents')).rows[0].count;
    await expect(rpc(operator, 'release_service_review_notification', { p_organization_id: org, p_customer_id: otherCustomer, p_engagement_id: f.engagement, p_revision_id: f.revision, p_notify: true })).rejects.toThrow();
    expect((await pg.query('select count(*) from service_notification_intents')).rows[0].count).toBe(count);
  });
  it('leases one worker, fences stale finishes, retries the same message and separates acceptance from delivery', async () => {
    await consent(); const f = await fixture(); const j = await claimReview(f.review);
    expect(j.message_id).toBeTruthy(); expect(await machine('claim_customer_notification', [j.job_id])).toBeNull();
    expect(await machine('finish_customer_notification', [j.job_id, randomUUID(), 'accepted', 'forged'])).toBe(false);
    expect(await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null])).toBe(true);
    const retry = await claimReview(f.review); expect(retry.message_id).toBe(j.message_id);
    await machine('finish_customer_notification', [retry.job_id, retry.lease_id, 'accepted', `provider-${f.review}`]);
    const current = async () => (await notificationHistory(operator, org, customer, f.engagement)).find(n => n.reviewId === f.review)!;
    expect((await current()).state).toBe('accepted');
    const event = async (kind: string, key = randomUUID()) => pg.query('select record_email_event($1,$2,$3,null,\'{}\',now())', [`provider-${f.review}`, kind, key]);
    await event('sent'); expect((await current()).state).toBe('sent');
    await event('delayed'); expect((await current()).state).toBe('delayed');
    await event('sent'); expect((await current()).state).toBe('sent');
    const key = randomUUID(); await event('delivered', key); await event('delivered', key); await event('sent');
    expect((await current()).state).toBe('delivered'); expect((await current()).events.filter(e => e.type === 'delivered')).toHaveLength(1);
    const timeline = await listCustomerTimeline(operator, { organizationId: org, customerId: customer });
    expect(timeline.some(e => e.action === 'notification.delivered' && e.description === 'Customer notification delivered' && e.actorName === 'Email delivery')).toBe(true);
    await event('bounced'); expect((await current()).state).toBe('bounced');
    expect((await notificationConfiguration(operator, org, customer)).suppressed).toBe(true);
    const later = await fixture(); expect((await notificationHistory(operator, org, customer, later.engagement)).every(n => n.state === 'suppressed')).toBe(true);
    expect((await pg.query("select record_email_event('unknown','delivered','unknown-event',null,'{}',now()) value")).rows[0].value).toBeNull();
  });
  it('revalidates consent after claim and cancels queued work on withdrawal without changing reviews', async () => {
    await consent(); const f = await fixture(); const j = await claimReview(f.review);
    await rpc(portal, 'withdraw_notification_consent');
    expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(false);
    expect((await notificationHistory(operator, org, customer, f.engagement)).every(n => n.state === 'suppressed')).toBe(true);
    expect((await pg.query('select state from service_reviews where id=$1', [f.review])).rows[0].state).toBe('pending');
    await expect(rpc(operator, 'retry_service_notification', { p_organization_id: org, p_intent_id: (await notificationHistory(operator, org, customer, f.engagement))[0].id })).rejects.toThrow();
  });
  it('blocks obsolete reviews and unready senders before provider dispatch', async () => {
    await consent(); const f = await fixture();
    await withdrawServiceReview(operator, org, customer, f.engagement, f.review, 1);
    expect((await claimReview(f.review)).held).toBe(true);
    const newer = await fixture();
    await releaseServiceDisclosure(operator, org, customer, newer.engagement, 2, 'publish', false);
    expect((await claimReview(newer.review)).held).toBe(true);
    const unready = await fixture();
    await pg.query("update email_identities set status='disabled' where organization_id=$1 and id=$2", [org, identity]);
    expect((await claimReview(unready.review)).held).toBe(true);
    await pg.query("update email_identities set status='active' where organization_id=$1 and id=$2", [org, identity]);
  });
  it('retries a previously unavailable sender without reissuing the review, and bounds attempts', async () => {
    await consent();
    await pg.query("update email_identities set status='disabled' where organization_id=$1 and id=$2", [org, identity]);
    const f = await fixture();
    const before = (await notificationHistory(operator, org, customer, f.engagement)).find(n => n.reviewId === f.review)!;
    expect(before.state).toBe('failed'); expect(before.messageId).toBeNull(); expect(before.mayRetry).toBe(false);
    await pg.query("update email_identities set status='active' where organization_id=$1 and id=$2", [org, identity]);
    expect((await notificationHistory(operator, org, customer, f.engagement)).find(n => n.id === before.id)?.mayRetry).toBe(true);
    const args = { p_organization_id: org, p_intent_id: before.id };
    const retries = await Promise.all([operator.rpc('retry_service_notification', args), operator.rpc('retry_service_notification', args)]);
    expect(retries.filter(r => !r.error)).toHaveLength(1);
    const current = (await notificationHistory(operator, org, customer, f.engagement)).find(n => n.id === before.id)!;
    expect(current.messageId).toBeTruthy(); expect(current.reviewId).toBe(f.review);
    for (let n = 0; n < 5; n++) { const claim = await claimReview(f.review); await machine('finish_customer_notification', [claim.job_id, claim.lease_id, 'retry', null]); }
    const exhausted = (await notificationHistory(operator, org, customer, f.engagement)).find(n => n.id === before.id)!;
    expect(exhausted.state).toBe('failed'); expect(exhausted.mayRetry).toBe(false); expect(exhausted.attempts).toHaveLength(5);
  });
  it('sends an optional withdrawal notice only for its own consent purpose and closes the old review notice', async () => {
    const p = await propose();
    await pg.query("update app.notification_challenges set purposes=array['service_review_requested','service_review_status_changed'] where id=$1", [p.id]);
    expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: p.code })).toBe(true);
    const f = await fixture();
    await withdrawServiceReview(operator, org, customer, f.engagement, f.review, 1, true);
    const history = await notificationHistory(operator, org, customer, f.engagement);
    expect(history.find(n => n.purpose === 'service_review_status_changed')?.state).toBe('queued');
    const statusJob = (await pg.query("select j.id from app.notification_jobs j join service_notification_intents i on i.organization_id=j.organization_id and i.id=j.intent_id where i.review_id=$1 and i.purpose='service_review_status_changed'", [f.review])).rows[0];
    const claim = await machine('claim_customer_notification', [statusJob.id]);
    expect(claim.subject).toContain('withdrawn');
    expect(await machine('authorize_customer_notification_send', [claim.job_id, claim.lease_id])).toBe(true);
    await machine('finish_customer_notification', [claim.job_id, claim.lease_id, 'accepted', `withdrawal-${f.review}`]);
  });
  it('the worker has no table grants and only the three notification execution doors', async () => {
    expect((await pg.query("select table_name from information_schema.role_table_grants where grantee='customer_notification_worker'")).rows).toEqual([]);
    const functions = (await pg.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('customer_notification_worker',p.oid,'execute') and not has_function_privilege('public',p.oid,'execute') order by p.proname")).rows.map(r => r.proname);
    expect(functions).toEqual(['authorize_customer_notification_send', 'claim_customer_notification', 'finish_customer_notification']);
  });
  it('does not suppress the recipient for a synchronous send refusal, but honors provider suppression callbacks', async () => {
    await consent(); const f = await fixture(); const j = await claimReview(f.review);
    await machine('finish_customer_notification', [j.job_id, j.lease_id, 'rejected', null]);
    expect((await notificationConfiguration(operator, org, customer)).suppressed).toBe(false);
    const failed = (await notificationHistory(operator, org, customer, f.engagement)).find(n => n.reviewId === f.review)!;
    expect(failed.state).toBe('rejected'); expect(failed.mayRetry).toBe(true);
    await rpc(operator, 'retry_service_notification', { p_organization_id: org, p_intent_id: failed.id });
    const retry = await claimReview(f.review);
    await machine('finish_customer_notification', [retry.job_id, retry.lease_id, 'accepted', `suppressed-${f.review}`]);
    await pg.query("select record_email_event($1,'rejected',$2,null,'{}',now())", [`suppressed-${f.review}`, randomUUID()]);
    expect((await notificationConfiguration(operator, org, customer)).suppressed).toBe(true);
  });
  it('bounds mailbox guesses, expiry and confirmation-request frequency without replacing existing consent', async () => {
    const p = await propose();
    for (let attempt = 0; attempt < 5; attempt++) expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: 'wrong' })).toBe(false);
    expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: p.id, p_code: p.code })).toBe(false);
    await expect(rpc(portal, 'propose_notification_recipient', { p_email_address: p.address, p_purposes: ['service_review_requested'] })).rejects.toThrow('wait');
    const expired = await propose();
    await pg.query("update app.notification_challenges set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    expect(await rpc(portal, 'confirm_notification_recipient', { p_challenge_id: expired.id, p_code: expired.code })).toBe(false);
    expect((await notificationConfiguration(operator, org, customer)).recipient?.email_address).not.toBe(expired.address);
    await expect(rpc(portal, 'propose_notification_recipient', { p_email_address: expired.address, p_purposes: ['marketing'] })).rejects.toThrow('purposes');
  });
  it('never reuses a provider idempotency key after its bounded retry window', async () => {
    await consent(); const f = await fixture(); const j = await claimReview(f.review);
    await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null]);
    await pg.query("update app.notification_jobs set first_attempt_at=now()-interval '24 hours' where id=$1", [j.job_id]);
    expect((await claimReview(f.review)).held).toBe(true);
    const history = (await notificationHistory(operator, org, customer, f.engagement)).find(n => n.reviewId === f.review)!;
    expect(history.state).toBe('failed'); expect(history.mayRetry).toBe(false);
  });
  it('preserves publication version conflicts and never mistakes a later draft save for a completed publish', async () => {
    await consent(); const f = await fixture();
    await expect(releaseServiceDisclosure(operator, org, customer, f.engagement, 1, 'publish', true)).rejects.toThrow('changed');
    await saveServiceDisclosure(operator, org, customer, f.engagement, 2, { title: 'Later draft', serviceKind: 'website', summary: 'New private draft', status: 'Draft', deliverables: [] });
    await expect(releaseServiceDisclosure(operator, org, customer, f.engagement, 2, 'publish', true)).rejects.toThrow('changed');
    expect((await disclosureEditorState(operator, org, customer, f.engagement)).disclosure?.published_revision_id).toBe(f.revision);
    expect((await notificationHistory(operator, org, customer, f.engagement)).filter(n => n.purpose === 'service_update_published')).toHaveLength(1);
  });
});

// Batch F.1: each case below reproduces a confirmed defect against the schema it was found in.
describe('notification delivery reliability', () => {
  let accountA: string; let accountB: string; let binding: string;
  const job = async (id: string) => (await pg.query('select j.state,j.lease_id,j.provider_account_id,j.dispatched_at,j.reason,m.status,m.external_id from app.notification_jobs j join messages m on m.organization_id=j.organization_id and m.id=j.message_id where j.id=$1', [id])).rows[0];
  const expire = (id: string) => pg.query("update app.notification_jobs set lease_until=now()-interval '1 second' where id=$1", [id]);
  const rebind = (account: string) => pg.query('update organization_provider_bindings set provider_account_id=$1 where id=$2', [account, binding]);
  const historyOf = async (f: { engagement: string; review: string }) => (await notificationHistory(operator, org, customer, f.engagement)).find(n => n.reviewId === f.review && n.purpose === 'service_review_requested')!;
  const eventTypes = async (message: string) => (await pg.query('select event_type from message_events where organization_id=$1 and message_id=$2 order by coalesce(provider_event_at,occurred_at),occurred_at', [org, message])).rows.map(r => r.event_type);
  const callback = (provider: string, kind: string, id = randomUUID(), at = 'now()') => pg.query(`select record_email_event($1,$2,$3,null,'{}',${at}) value`, [provider, kind, id]).then(r => r.rows[0].value);
  async function worker() {
    const c = new Client(connection); await c.connect();
    await c.query('begin'); await c.query('set local role customer_notification_worker');
    return c;
  }
  beforeAll(async () => {
    const insert = async (label: string) => (await pg.query("insert into platform_provider_accounts(provider_key,label,credential_kind,credential_identifier,credential_set_at) values('resend',$1,'api_key','fixture-key',now()) returning id", [`${label} ${randomUUID().slice(0, 8)}`])).rows[0].id;
    accountA = await insert('Tenant mail A'); accountB = await insert('Tenant mail B');
    binding = (await pg.query('select binding_id from organization_provider_resources where organization_id=$1 and id=$2', [org, domain])).rows[0].binding_id;
    await rebind(accountA);
  });

  describe('lease fencing', () => {
    it('refuses completion on an expired lease nobody reclaimed, and keeps the late provider answer instead of resending', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      await expire(j.job_id);
      expect(await machine('finish_customer_notification', [j.job_id, j.lease_id, 'accepted', `late-${f.review}`])).toBe(false);
      // Expiry is not proof the provider did nothing: nothing is marked failed or re-sendable yet.
      expect(await job(j.job_id)).toMatchObject({ state: 'sending', status: 'sending', external_id: null });
      expect(await machine('claim_customer_notification', [j.job_id])).toMatchObject({ held: true, reconciled: true });
      expect(await job(j.job_id)).toMatchObject({ state: 'accepted', status: 'sent', external_id: `late-${f.review}` });
      expect((await historyOf(f)).attempts.map(a => a.outcome)).toEqual(['late_accepted']);
    });
    it('retries an expired lease with no provider answer under the same message key and account', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      await expire(j.job_id);
      expect(await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null])).toBe(false);
      const again = await machine('claim_customer_notification', [j.job_id]);
      expect(again).toMatchObject({ message_id: j.message_id, provider_account_id: accountA });
      expect(again.lease_id).not.toBe(j.lease_id);
      expect((await historyOf(f)).attempts[0].outcome).toBe('lease_expired');
    });
    it('refuses completion from a reclaimed lease but lets its definitive answer outrank an inconclusive current one', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      await expire(j.job_id);
      const current = await machine('claim_customer_notification', [j.job_id]);
      expect(await machine('finish_customer_notification', [j.job_id, j.lease_id, 'accepted', `stale-${f.review}`])).toBe(false);
      expect(await machine('finish_customer_notification', [current.job_id, current.lease_id, 'retry', null])).toBe(true);
      expect(await job(j.job_id)).toMatchObject({ state: 'accepted', status: 'sent', external_id: `stale-${f.review}` });
      expect(await machine('finish_customer_notification', [current.job_id, current.lease_id, 'accepted', 'again'])).toBe(false);
    });
    it('completes the current lease exactly once when two completions race', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      const [a, b] = [await worker(), await worker()];
      try {
        const first = (await a.query('select public.finish_customer_notification($1,$2,$3,$4) v', [j.job_id, j.lease_id, 'accepted', `race-a-${f.review}`])).rows[0].v;
        const second = b.query('select public.finish_customer_notification($1,$2,$3,$4) v', [j.job_id, j.lease_id, 'accepted', `race-b-${f.review}`]);
        await new Promise(resolve => setTimeout(resolve, 300));
        await a.query('commit');
        const secondValue = (await second).rows[0].v; await b.query('commit');
        expect([first, secondValue]).toEqual([true, false]);
      } finally { await a.end(); await b.end(); }
      expect(await job(j.job_id)).toMatchObject({ state: 'accepted', external_id: `race-a-${f.review}` });
      expect((await historyOf(f)).attempts.map(a => a.outcome)).toEqual(['accepted']);
    });
  });

  describe('early provider callbacks', () => {
    it('keeps a signed delivery callback that arrives before acceptance and applies it once, when acceptance is recorded', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      const provider = `early-${f.review}`; const delivered = randomUUID();
      expect(await callback(provider, 'delivered', delivered)).toBeNull();
      expect(await eventTypes(j.message_id)).not.toContain('delivered');
      expect(await machine('finish_customer_notification', [j.job_id, j.lease_id, 'accepted', provider])).toBe(true);
      expect((await historyOf(f)).state).toBe('delivered');
      await callback(provider, 'delivered', delivered); await callback(provider, 'sent');
      expect((await historyOf(f)).state).toBe('delivered');
      expect((await eventTypes(j.message_id)).filter(t => t === 'delivered')).toHaveLength(1);
      expect((await pg.query('select count(*)::int n from app.email_early_events where provider_message_id=$1', [provider])).rows[0].n).toBe(0);
    });
    it('applies out-of-order and duplicate early callbacks in provider order, with failure outranking delivery', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      const provider = `ordered-${f.review}`; const bounce = randomUUID();
      await callback(provider, 'bounced', bounce, "now()");
      await callback(provider, 'bounced', bounce, "now()");
      await callback(provider, 'delivered', randomUUID(), "now()-interval '30 seconds'");
      await callback(provider, 'sent', randomUUID(), "now()-interval '1 minute'");
      await machine('finish_customer_notification', [j.job_id, j.lease_id, 'accepted', provider]);
      const types = await eventTypes(j.message_id);
      expect(types.filter(t => ['sent', 'delivered', 'bounced'].includes(t))).toEqual(['sent', 'delivered', 'bounced']);
      expect((await historyOf(f)).state).toBe('bounced');
      // Delivery was applied before the bounce, not discarded by it: replay followed the provider's order.
      expect((await pg.query('select status,delivered_at from messages where organization_id=$1 and id=$2', [org, j.message_id])).rows[0]).toMatchObject({ status: 'bounced', delivered_at: expect.any(Date) });
    });
    it('never loses a callback that races the acceptance that correlates it', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      const provider = `racing-${f.review}`;
      const accepting = await worker(); const webhook = new Client(connection); await webhook.connect();
      try {
        await accepting.query('select public.finish_customer_notification($1,$2,$3,$4)', [j.job_id, j.lease_id, 'accepted', provider]);
        const arriving = webhook.query("select record_email_event($1,'delivered',$2,null,'{}',now()) value", [provider, randomUUID()]);
        await new Promise(resolve => setTimeout(resolve, 300));
        await accepting.query('commit');
        await arriving;
      } finally { await accepting.end(); await webhook.end(); }
      expect((await eventTypes(j.message_id)).filter(t => t === 'delivered')).toHaveLength(1);
      expect((await historyOf(f)).state).toBe('delivered');
    });
    it('holds early evidence privately and bounded, and reconciles it only into the message that owns the provider id', async () => {
      const elsewhere = async () => (await pg.query('select count(*)::int n from message_events where organization_id<>$1', [org])).rows[0].n;
      const before = await elsewhere();
      const flood = `flood-${randomUUID()}`;
      for (let n = 0; n < 25; n++) await callback(flood, 'delayed');
      const buffered = async (provider: string) => (await pg.query('select count(*)::int n from app.email_early_events where provider_message_id=$1', [provider])).rows[0].n;
      expect(await buffered(flood)).toBe(20);
      await pg.query("select record_email_event($1,'delayed',$2,null,$3::jsonb,now())", [`large-${flood}`, randomUUID(), JSON.stringify({ filler: 'x'.repeat(40_000) })]);
      expect((await pg.query('select octet_length(payload::text) n from app.email_early_events where provider_message_id=$1', [`large-${flood}`])).rows[0].n).toBeLessThan(100);
      await pg.query("update app.email_early_events set received_at=now()-interval '3 days' where provider_message_id=$1", [flood]);
      await callback(`purge-${flood}`, 'delayed');
      expect(await buffered(flood)).toBe(0);
      for (const role of ['authenticated', 'anon', 'customer_notification_worker', 'tenant_email_webhook', 'provider_operator']) {
        expect((await pg.query("select has_table_privilege($1,'app.email_early_events','select') a, has_table_privilege($1,'app.notification_send_evidence','select') b", [role])).rows[0]).toEqual({ a: false, b: false });
      }
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      const provider = `owned-${f.review}`;
      await callback(provider, 'delivered');
      expect(await elsewhere()).toBe(before);
      await machine('finish_customer_notification', [j.job_id, j.lease_id, 'accepted', provider]);
      expect((await eventTypes(j.message_id)).filter(t => t === 'delivered')).toHaveLength(1);
      expect(await elsewhere()).toBe(before);
    });
  });

  describe('provider account stability', () => {
    it('pins the provider account on first claim and keeps it through credential rotation', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(j.provider_account_id).toBe(accountA);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null]);
      await pg.query("update platform_provider_accounts set credential_identifier='rotated-key',credential_set_at=now() where id=$1", [accountA]);
      const retry = await claimReview(f.review);
      expect(retry).toMatchObject({ message_id: j.message_id, provider_account_id: accountA });
      expect(retry.held).toBeUndefined();
    });
    it('re-pins explicitly when the account changes before any attempt reached a provider', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null]);
      await rebind(accountB);
      try {
        const retry = await claimReview(f.review);
        expect(retry.provider_account_id).toBe(accountB);
        expect((await historyOf(f)).attempts[1].detail).toContain('Provider account changed');
      } finally { await rebind(accountA); }
    });
    it('holds a delivery as uncertain when the account changes after an attempt may have reached the provider', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null]);
      await rebind(accountB);
      try {
        expect(await claimReview(f.review)).toEqual({ held: true });
        expect(await job(j.job_id)).toMatchObject({ state: 'held', status: 'sending', external_id: null, provider_account_id: accountA });
        const history = await historyOf(f);
        expect(history.state).toBe('uncertain'); expect(history.mayRetry).toBe(false);
        await expect(rpc(operator, 'retry_service_notification', { p_organization_id: org, p_intent_id: history.id })).rejects.toThrow('cannot be retried');
      } finally { await rebind(accountA); }
      expect(await claimReview(f.review)).toBeNull();
    });
    it('refuses dispatch when the account changes between claim and authorization', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      await rebind(accountB);
      try {
        expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(false);
        expect(await job(j.job_id)).toMatchObject({ state: 'queued', dispatched_at: null });
        const repinned = await claimReview(f.review);
        expect(repinned.provider_account_id).toBe(accountB);
        expect(await machine('authorize_customer_notification_send', [repinned.job_id, repinned.lease_id])).toBe(true);
        await machine('finish_customer_notification', [repinned.job_id, repinned.lease_id, 'retry', null]);
      } finally { await rebind(accountA); }
      const uncertain = await claimReview(f.review);
      expect(uncertain).toEqual({ held: true });
    });
    it('holds rather than fails a possibly sent message whose provider idempotency window has expired', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(true);
      await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null]);
      await pg.query("update app.notification_jobs set first_attempt_at=now()-interval '24 hours',dispatched_at=now()-interval '24 hours' where id=$1", [j.job_id]);
      expect(await claimReview(f.review)).toEqual({ held: true });
      expect(await job(j.job_id)).toMatchObject({ state: 'held', status: 'sending' });
      expect((await historyOf(f)).state).toBe('uncertain');
    });
  });

  describe('worker execution budget', () => {
    it('refuses dispatch without enough lease left to finish, and bounds the worker’s lock waits', async () => {
      await consent(); const f = await fixture(); const j = await claimReview(f.review);
      await pg.query("update app.notification_jobs set lease_until=now()+interval '30 seconds' where id=$1", [j.job_id]);
      expect(await machine('authorize_customer_notification_send', [j.job_id, j.lease_id])).toBe(false);
      expect(await job(j.job_id)).toMatchObject({ state: 'sending', dispatched_at: null });
      const holder = new Client(connection); await holder.connect();
      try {
        await holder.query('begin'); await holder.query('select 1 from app.notification_jobs where id=$1 for update', [j.job_id]);
        const started = Date.now();
        const blocked = machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null]).then(() => 'finished', (error: { code?: string }) => error.code);
        const outcome = await Promise.race([blocked, new Promise(resolve => setTimeout(() => resolve('still waiting'), 8_000))]);
        expect(outcome).toBe('55P03');
        expect(Date.now() - started).toBeLessThan(6_000);
      } finally { await holder.query('rollback'); await holder.end(); }
      expect(await machine('finish_customer_notification', [j.job_id, j.lease_id, 'retry', null])).toBe(true);
      expect((await pg.query("select rolconfig from pg_roles where rolname='customer_notification_worker'")).rows[0].rolconfig).toContain('statement_timeout=5s');
    }, 30_000);
  });
});
