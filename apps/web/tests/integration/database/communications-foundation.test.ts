import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beginProviderBinding, recordProviderResource } from '@/lib/domain/providers/bindings';
import { createEmailIdentity, listEmailIdentities, resolveEmailSender } from '@/lib/domain/email/identities';
import { getConversation, listConversations } from '@/lib/domain/reception/messaging';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * The multi-channel foundation, against real Postgres and real RLS: a conversation that is not
 * defined by a phone number, and an email address that is not defined by a domain.
 *
 * Privileged setup (an address with no tenant writer yet, a state change only a provider may
 * make) goes through a superuser connection, which bypasses RLS but not a trigger, a check or a
 * foreign key — so those are exactly what is being proved when it is refused.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; domainResourceId: string; domain: string };

let pg: Client;
let staff: SupabaseClient;
let mine: Tenant;
let other: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });

  // A sending domain the way a business really names one: through its own door.
  const domain = `${label}-${randomUUID().slice(0, 6)}.example.test`;
  const named = await db.rpc('record_organization_email_domain', { p_organization_id: organizationId, p_domain: domain });
  if (named.error) throw named.error;
  return { db, userId: created.data.user.id, organizationId, domainResourceId: named.data as string, domain };
}

async function seedNumber(tenant: Tenant, e164: string): Promise<string> {
  await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
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
  return data as string;
}

/** The provider saying where a sending domain stands — the only way it ever leaves `pending`. */
async function providerSays(tenant: Tenant, status: 'pending' | 'active' | 'failed') {
  await pg.query('begin');
  try {
    await pg.query('set local role provider_operator');
    await pg.query(`select public.record_email_domain_provisioning($1, $2, $3)`, [tenant.organizationId, tenant.domainResourceId, status]);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

/** An identity row written past the tenant policy, for the ownership modes no tenant may create. */
async function insertIdentity(columns: Record<string, unknown>) {
  const keys = Object.keys(columns);
  return pg.query(
    `insert into public.email_identities (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    keys.map((key) => columns[key]),
  );
}

beforeAll(async () => {
  pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  [mine, other, staff] = await Promise.all([newTenant('fnd-a'), newTenant('fnd-b'), asPlatformStaff()]);
}, 90_000);

afterAll(async () => {
  await pg.end();
});

describe('a conversation belongs to a channel', () => {
  it('keeps an SMS conversation an SMS conversation, with its number pair, and defaults new ones to sms', async () => {
    const numberId = await seedNumber(mine, '+14165550401');
    const created = await mine.db
      .from('conversations')
      .insert({ organization_id: mine.organizationId, phone_number_id: numberId, external_number: '+14165550411' })
      .select('id, channel')
      .single();
    expect(created.error).toBeNull();
    expect(created.data?.channel).toBe('sms');

    const found = await getConversation(mine.db as never, { organizationId: mine.organizationId, conversationId: created.data!.id });
    expect(found).toMatchObject({ channel: 'sms', phoneNumberId: numberId, externalNumber: '+14165550411' });
  });

  it('still allows one SMS conversation per number pair', async () => {
    const numberId = await seedNumber(mine, '+14165550402');
    const row = { organization_id: mine.organizationId, phone_number_id: numberId, external_number: '+14165550412' };
    expect((await mine.db.from('conversations').insert(row)).error).toBeNull();
    expect((await mine.db.from('conversations').insert(row)).error?.code).toBe('23505');
  });

  it('can hold an email conversation with no phone number and no external number', async () => {
    const identity = await insertIdentity({
      organization_id: mine.organizationId,
      address: `support@${mine.domain}`,
      ownership: 'customer_domain',
      sending_domain_resource_id: mine.domainResourceId,
    });
    const identityId = identity.rows[0].id as string;

    const inserted = await pg.query(
      `insert into public.conversations (organization_id, channel, email_identity_id, external_email) values ($1, 'email', $2, 'customer@example.test') returning id`,
      [mine.organizationId, identityId],
    );
    const conversationId = inserted.rows[0].id as string;

    const found = await getConversation(mine.db as never, { organizationId: mine.organizationId, conversationId });
    expect(found).toMatchObject({ channel: 'email', emailIdentityId: identityId });
    expect(found).not.toHaveProperty('phoneNumberId');

    // The SMS inbox lists SMS only; the unfiltered list sees both.
    const sms = await listConversations(mine.db as never, { organizationId: mine.organizationId, channel: 'sms' });
    expect(sms.every((conversation) => conversation.channel === 'sms')).toBe(true);
    const all = await listConversations(mine.db as never, { organizationId: mine.organizationId });
    expect(all.map((conversation) => conversation.id)).toContain(conversationId);
  });

  it('refuses a conversation that is neither or both: an email thread with a phone number, an SMS thread with none', async () => {
    const numberId = await seedNumber(mine, '+14165550403');
    const identity = await insertIdentity({
      organization_id: mine.organizationId,
      address: `both@${mine.domain}`,
      ownership: 'customer_domain',
      sending_domain_resource_id: mine.domainResourceId,
    });

    await expect(
      pg.query(
        `insert into public.conversations (organization_id, channel, email_identity_id, external_email, phone_number_id, external_number) values ($1, 'email', $2, 'customer@example.test', $3, '+14165550413')`,
        [mine.organizationId, identity.rows[0].id, numberId],
      ),
    ).rejects.toMatchObject({ constraint: 'conversations_channel_addressing' });

    await expect(
      pg.query(`insert into public.conversations (organization_id, channel) values ($1, 'sms')`, [mine.organizationId]),
    ).rejects.toMatchObject({ constraint: 'conversations_channel_addressing' });
  });

  it('refuses a conversation spoken through another business’s address', async () => {
    const theirs = await insertIdentity({
      organization_id: other.organizationId,
      address: `hello@${other.domain}`,
      ownership: 'customer_domain',
      sending_domain_resource_id: other.domainResourceId,
    });

    await expect(
      pg.query(`insert into public.conversations (organization_id, channel, email_identity_id, external_email) values ($1, 'email', $2, 'customer@example.test')`, [
        mine.organizationId,
        theirs.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('does not let a signed-in caller create an email thread by hand — no writer for one exists yet', async () => {
    const identity = await insertIdentity({
      organization_id: mine.organizationId,
      address: `thread@${mine.domain}`,
      ownership: 'customer_domain',
      sending_domain_resource_id: mine.domainResourceId,
    });
    const { error } = await mine.db
      .from('conversations')
      .insert({ organization_id: mine.organizationId, channel: 'email', email_identity_id: identity.rows[0].id, external_email: 'customer@example.test' });
    expect(error).not.toBeNull();
  });

  it('shows one business none of another’s conversations, of either channel', async () => {
    const read = await other.db.from('conversations').select('id').eq('organization_id', mine.organizationId);
    expect(read.data ?? []).toEqual([]);
  });
});

describe('an email identity is an address, not a domain', () => {
  it('lets a business name an address beneath its own sending domain, send-only, and reads it back tenant-scoped', async () => {
    const identity = await createEmailIdentity(mine.db as never, {
      organizationId: mine.organizationId,
      address: `Hello@${mine.domain}`,
      displayName: 'Acme',
      sendingDomainResourceId: mine.domainResourceId,
    });
    expect(identity).toMatchObject({ address: `hello@${mine.domain}`, ownership: 'customer_domain', canSend: true, canReceive: false });

    const theirs = await other.db.from('email_identities').select('id').eq('organization_id', mine.organizationId);
    expect(theirs.data ?? []).toEqual([]);
  });

  it('derives readiness from the sending domain, which stays the one authority', async () => {
    const identity = await createEmailIdentity(mine.db as never, {
      organizationId: mine.organizationId,
      address: `derive@${mine.domain}`,
      sendingDomainResourceId: mine.domainResourceId,
    });
    const readinessOf = async () =>
      (await listEmailIdentities(mine.db as never, { organizationId: mine.organizationId })).find((row) => row.id === identity.id)!.readiness.state;

    expect(await readinessOf()).toBe('pending');
    await expect(resolveEmailSender(mine.db as never, { organizationId: mine.organizationId, emailIdentityId: identity.id })).rejects.toMatchObject({
      code: 'email_identity.not_ready',
    });

    await providerSays(mine, 'active');
    expect(await readinessOf()).toBe('ready');
    await expect(
      resolveEmailSender(mine.db as never, { organizationId: mine.organizationId, emailIdentityId: identity.id }),
    ).resolves.toMatchObject({ address: `derive@${mine.domain}` });

    // The domain fails a recheck: the identity says nothing different, because it stores nothing.
    await providerSays(mine, 'failed');
    expect(await readinessOf()).toBe('unavailable');
  });

  it('refuses to resolve a sender from another business’s identity', async () => {
    const theirs = await insertIdentity({
      organization_id: other.organizationId,
      address: `sales@${other.domain}`,
      ownership: 'customer_domain',
      sending_domain_resource_id: other.domainResourceId,
    });
    await expect(
      resolveEmailSender(mine.db as never, { organizationId: mine.organizationId, emailIdentityId: theirs.rows[0].id }),
    ).rejects.toMatchObject({ code: 'email_identity.not_found' });
  });

  it('refuses an address that is not beneath the sending domain it names', async () => {
    await expect(
      createEmailIdentity(mine.db as never, {
        organizationId: mine.organizationId,
        address: 'hello@somewhere-else.example.test',
        sendingDomainResourceId: mine.domainResourceId,
      }),
    ).rejects.toMatchObject({ code: 'email_identity.invalid' });
  });

  it('refuses to claim another business’s sending domain', async () => {
    await expect(
      createEmailIdentity(mine.db as never, {
        organizationId: mine.organizationId,
        address: `hello@${other.domain}`,
        sendingDomainResourceId: other.domainResourceId,
      }),
    ).rejects.toMatchObject({ code: 'email_identity.invalid' });
  });

  it('refuses a resource that is not a sending domain', async () => {
    const numberId = await seedNumber(mine, '+14165550404');
    const { data: number } = await mine.db.from('phone_numbers').select('provider_resource_id').eq('id', numberId).single();
    await expect(
      insertIdentity({
        organization_id: mine.organizationId,
        address: `phone@${mine.domain}`,
        ownership: 'customer_domain',
        sending_domain_resource_id: number!.provider_resource_id,
      }),
    ).rejects.toThrow(/not a sending domain/);
  });

  it('gives a tenant no way to create a managed address, a connected mailbox, or a receiving identity', async () => {
    const base = { organization_id: mine.organizationId, created_by: mine.userId };
    const managed = await mine.db.from('email_identities').insert({ ...base, address: 'a@managed.example.test', ownership: 'gildops_managed' });
    expect(managed.error).not.toBeNull();

    const mailbox = await mine.db.from('email_identities').insert({ ...base, address: `m@${mine.domain}`, ownership: 'connected_mailbox' });
    expect(mailbox.error).not.toBeNull();

    // `can_receive` is not even a column a tenant may write.
    const receiving = await mine.db
      .from('email_identities')
      .insert({ ...base, address: `r@${mine.domain}`, ownership: 'customer_domain', sending_domain_resource_id: mine.domainResourceId, can_receive: true });
    expect(receiving.error).not.toBeNull();
  });

  it('never lets an address or its ownership change after it is named', async () => {
    const identity = await createEmailIdentity(mine.db as never, {
      organizationId: mine.organizationId,
      address: `fixed@${mine.domain}`,
      sendingDomainResourceId: mine.domainResourceId,
    });
    const changed = await mine.db.from('email_identities').update({ address: `other@${mine.domain}` }).eq('id', identity.id);
    expect(changed.error?.code).toBe('42501');
  });

  it('lets a business state that an address receives, after naming it send-only — it cannot be born receiving', async () => {
    const identity = await createEmailIdentity(mine.db as never, {
      organizationId: mine.organizationId,
      address: `inbox@${mine.domain}`,
      sendingDomainResourceId: mine.domainResourceId,
    });
    expect(identity.canReceive).toBe(false);

    const stated = await mine.db.from('email_identities').update({ can_receive: true }).eq('id', identity.id).select('can_receive').single();
    expect(stated.data?.can_receive).toBe(true);
  });

  it('represents the other two ownership modes without a fake domain or a fake mailbox', async () => {
    // GildOps-managed: no sending-domain resource, may send and may receive.
    const managed = await insertIdentity({
      organization_id: mine.organizationId,
      address: `inbound@managed-${randomUUID().slice(0, 6)}.example.test`,
      ownership: 'gildops_managed',
      can_receive: true,
    });
    const listed = await listEmailIdentities(mine.db as never, { organizationId: mine.organizationId });
    const managedView = listed.find((row) => row.id === managed.rows[0].id)!;
    expect(managedView).toMatchObject({ ownership: 'gildops_managed', canSend: true, canReceive: true, sendingDomainResourceId: null });
    // No managed domain exists, so no managed address is claimed ready.
    expect(managedView.readiness.state).toBe('unavailable');

    // A connected mailbox: backed by a connection, and a mailbox because it receives.
    const connection = await pg.query(
      `insert into public.integration_connections (organization_id, connector_key, connected_by, status) values ($1, 'google_workspace', $2, 'active') returning id`,
      [mine.organizationId, mine.userId],
    );
    const mailbox = await insertIdentity({
      organization_id: mine.organizationId,
      address: `support-box@${mine.domain}`,
      ownership: 'connected_mailbox',
      can_receive: true,
      integration_connection_id: connection.rows[0].id,
    });
    const mailboxView = (await listEmailIdentities(mine.db as never, { organizationId: mine.organizationId })).find((row) => row.id === mailbox.rows[0].id)!;
    expect(mailboxView).toMatchObject({ ownership: 'connected_mailbox', canReceive: true, sendingDomainResourceId: null });
    expect(mailboxView.readiness.state).toBe('ready');

    // A connected mailbox with no connection, or a connection on anything else, is refused.
    await expect(
      insertIdentity({ organization_id: mine.organizationId, address: `x@${mine.domain}`, ownership: 'connected_mailbox', can_receive: true }),
    ).rejects.toMatchObject({ constraint: 'email_identities_connected_mailbox_has_a_connection' });
    await expect(
      insertIdentity({
        organization_id: mine.organizationId,
        address: `y@${mine.domain}`,
        ownership: 'gildops_managed',
        integration_connection_id: connection.rows[0].id,
      }),
    ).rejects.toMatchObject({ constraint: 'email_identities_connected_mailbox_has_a_connection' });
  });

  it('refuses an identity that does nothing, and a connection from another business', async () => {
    await expect(
      insertIdentity({ organization_id: mine.organizationId, address: `none@managed.example.test`, ownership: 'gildops_managed', can_send: false, can_receive: false }),
    ).rejects.toMatchObject({ constraint: 'email_identities_does_something' });

    const theirConnection = await pg.query(
      `insert into public.integration_connections (organization_id, connector_key, connected_by, status) values ($1, 'google_workspace', $2, 'active') returning id`,
      [other.organizationId, other.userId],
    );
    await expect(
      insertIdentity({
        organization_id: mine.organizationId,
        address: `z@${mine.domain}`,
        ownership: 'connected_mailbox',
        can_receive: true,
        integration_connection_id: theirConnection.rows[0].id,
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('keeps an address and its history when its sending domain is released, and says it is no longer ready', async () => {
    const tenant = await newTenant('fnd-release');
    const identity = await createEmailIdentity(tenant.db as never, {
      organizationId: tenant.organizationId,
      address: `hello@${tenant.domain}`,
      sendingDomainResourceId: tenant.domainResourceId,
    });

    const released = await tenant.db.rpc('release_organization_email_domain', {
      p_organization_id: tenant.organizationId,
      p_resource_id: tenant.domainResourceId,
    });
    expect(released.error).toBeNull();

    const view = (await listEmailIdentities(tenant.db as never, { organizationId: tenant.organizationId })).find((row) => row.id === identity.id)!;
    expect(view.sendingDomainResourceId).toBeNull();
    expect(view.readiness.state).toBe('unavailable');
  });
});
