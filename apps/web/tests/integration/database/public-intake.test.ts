import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { submitPublicInquiry } from '@/lib/domain/public-intake/public-intake';
import { listCustomers } from '@/lib/domain/customers/customers';
import { getDiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The marketing site's demo and contact forms, and the one write it may perform
 * (product reality audit, Slice 5).
 *
 * **Narrower than booking on purpose.** `booking.test.ts` proves a stranger can read back their
 * own booking; this proves the opposite — after submitting, a caller can read nothing at all,
 * because no select policy anywhere is keyed to this axis. What carries the whole record here is
 * the same shape the no-grant-rather-than-policy rule already proved for platform staff: absence of a grant, not a policy that
 * happens to decline.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function withConnection<T>(run: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  try {
    return await run(pg);
  } finally {
    await pg.end();
  }
}

async function pointAt(organizationId: string | null): Promise<void> {
  await withConnection((pg) =>
    pg.query('update public.platform_settings set workflow_review_organization_id = $1 where singleton', [
      organizationId,
    ]),
  );
}

type Target = { db: SupabaseClient; organizationId: string };

let target: Target;

describe('the public intake, by somebody who is a member of nothing', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `wr-owner-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;

    const db = anonClient();
    const { error: signInError } = await db.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const organizationId = (await foundBusiness({
      ownerEmail: email,
      name: 'Gold (test)',
      currency: 'CAD',
    })) as string;

    target = { db, organizationId };
    await pointAt(organizationId);
  });

  afterEach(async () => {
    // Every test that reconfigures the target restores it, so order between tests never matters.
    await pointAt(target.organizationId);
  });

  it('requires an authenticated caller', async () => {
    const stranger = anonClient();
    const { error } = await stranger.rpc('submit_public_inquiry', {
      p_kind: 'demo',
      p_topic: '',
      p_name: 'No Session',
      p_business_name: 'No Session Ltd',
      p_email: '',
      p_phone: '',
      p_context: '',
      p_team_size: '',
      p_business_type: '',
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('writes one ordinary customer into the configured organization', async () => {
    const visitor = anonClient();
    await submitPublicInquiry(visitor, {
      kind: 'demo',
      name: 'Priya Shah',
      businessName: 'Shah Landscaping',
      email: 'priya@example.test',
      phone: '555-0100',
      context: 'Three crews, booked over text today.',
      teamSize: '3',
      businessType: 'Landscaping',
    });

    const customers = await listCustomers(target.db, { organizationId: target.organizationId });
    const written = customers.find((customer) => customer.name === 'Shah Landscaping');
    expect(written).toBeDefined();
    expect(written!.email).toBe('priya@example.test');
    expect(written!.phone).toBe('555-0100');

    // No pipeline invented on the prospect's behalf (docs/domain-model.md: customer_stages has
    // no seeded values) — this holds whether or not Reception happens to be configured here.
    expect(written!.stageId).toBeNull();
  });

  it('starts a discovery snapshot from whatever the form already collected', async () => {
    const visitor = anonClient();
    await submitPublicInquiry(visitor, {
      kind: 'demo',
      name: 'Priya Shah',
      businessName: 'Discovery Seeded Co',
      email: 'priya-seed@example.test',
      phone: '',
      context: 'Three crews, booked over text today.',
      teamSize: '3',
      businessType: 'Landscaping',
    });

    const customers = await listCustomers(target.db, { organizationId: target.organizationId });
    const written = customers.find((customer) => customer.name === 'Discovery Seeded Co');
    expect(written).toBeDefined();

    const snapshot = await getDiscoverySnapshot(target.db, {
      organizationId: target.organizationId,
      customerId: written!.id,
    });
    expect(snapshot?.answers.teamAccess).toMatchObject({ value: '3', status: 'provided', source: 'demo_form' });
    expect(snapshot?.answers.existingSoftware).toMatchObject({
      value: 'Three crews, booked over text today.',
      status: 'provided',
      source: 'demo_form',
    });
  });

  it('starts no discovery snapshot when the form gave nothing to map', async () => {
    const visitor = anonClient();
    await submitPublicInquiry(visitor, {
      kind: 'contact',
      name: 'No Mappable Fields',
      email: 'no-mappable@example.test',
      topic: 'General question',
      context: 'Just saying hello.',
    });

    // `context` on a contact inquiry is a message to a person, not a discovery answer about the
    // business's tools — the mapping only ever reads `context` on a demo request.
    const customers = await listCustomers(target.db, { organizationId: target.organizationId });
    const written = customers.find((customer) => customer.name === 'No Mappable Fields');
    expect(written).toBeDefined();

    const snapshot = await getDiscoverySnapshot(target.db, {
      organizationId: target.organizationId,
      customerId: written!.id,
    });
    expect(snapshot).toBeNull();
  });

  it('records an attributable event using the existing customer.created vocabulary', async () => {
    const visitor = anonClient();
    await submitPublicInquiry(visitor, {
      kind: 'demo',
      name: 'Contact Person',
      businessName: 'Event Vocabulary Co',
      email: '',
      phone: '',
      context: 'Everything is on paper right now.',
      teamSize: '',
      businessType: '',
    });

    const { rows } = await withConnection((pg) =>
      pg.query<{ actor_id: string; action: string; payload: Record<string, unknown> }>(
        `select actor_id, action, payload from public.events
          where organization_id = $1 and payload->>'name' = $2`,
        [target.organizationId, 'Event Vocabulary Co'],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('customer.created');
    expect(typeof rows[0].actor_id).toBe('string');
    expect(rows[0].payload).toMatchObject({
      source: 'demo',
      contact_name: 'Contact Person',
      context: 'Everything is on paper right now.',
    });
  });

  it('leaves the visitor no way to read anything back', async () => {
    const visitor = anonClient();
    const { error: signInError } = await visitor.auth.signInAnonymously();
    if (signInError) throw signInError;

    const { error } = await visitor.rpc('submit_public_inquiry', {
      p_kind: 'demo',
      p_topic: '',
      p_name: 'Reads Nothing',
      p_business_name: 'Reads Nothing Ltd',
      p_email: '',
      p_phone: '',
      p_context: '',
      p_team_size: '',
      p_business_type: '',
    });
    expect(error).toBeNull();

    // Called the RPC directly rather than through `submitPublicInquiry`, so the session is
    // still live here — this is the database's own guarantee, not the domain layer's manners.
    const { data: customers } = await visitor.from('customers').select('id');
    expect(customers ?? []).toEqual([]);

    const { data: events } = await visitor.from('events').select('id');
    expect(events ?? []).toEqual([]);

    const { data: orgs } = await visitor.from('organizations').select('id');
    expect(orgs ?? []).toEqual([]);

    const { data: memberships } = await visitor.from('memberships').select('id');
    expect(memberships ?? []).toEqual([]);

    const { data: snapshots } = await visitor.from('customer_discovery_snapshots').select('id');
    expect(snapshots ?? []).toEqual([]);
  });

  it('creates no external_actors binding for the visitor', async () => {
    const visitor = anonClient();
    await submitPublicInquiry(visitor, {
      kind: 'demo',
      name: 'No Binding',
      businessName: 'No Binding Ltd',
      email: '',
      phone: '',
      context: '',
      teamSize: '',
      businessType: '',
    });

    const { data: user } = await visitor.auth.getUser();
    // signOut() clears the client-side session, but the user id it minted is still a fact we
    // can check against the table directly — the binding table booking uses for its own axis.
    const { rows } = await withConnection((pg) =>
      pg.query('select 1 from public.external_actors where user_id = $1', [user.user?.id ?? null]),
    );
    expect(rows).toHaveLength(0);
  });

  it('signs the visitor out once the request completes, successfully or not', async () => {
    const visitor = anonClient();
    await submitPublicInquiry(visitor, {
      kind: 'demo',
      name: 'Signs Out',
      businessName: 'Signs Out Ltd',
      email: '',
      phone: '',
      context: '',
      teamSize: '',
      businessType: '',
    });

    const { data } = await visitor.auth.getUser();
    expect(data.user).toBeNull();
  });

  it('cannot be called with an organization id of the caller\'s choosing', async () => {
    // The function takes no such parameter at all — checked against the catalogue rather than
    // by trying to pass one, since PostgREST would simply reject an unknown named argument
    // rather than proving anything about what the function trusts.
    const { rows } = await withConnection((pg) =>
      pg.query<{ argument_name: string }>(
        `select unnest(p.proargnames) as argument_name
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'submit_public_inquiry'`,
      ),
    );
    expect(rows.map((row) => row.argument_name)).not.toContain('p_organization_id');
  });

  it('refuses honestly when no deployment target is configured', async () => {
    await pointAt(null);

    const visitor = anonClient();
    await expect(
      submitPublicInquiry(visitor, {
      kind: 'demo',
        name: 'Unconfigured',
        businessName: 'Unconfigured Ltd',
        email: '',
        phone: '',
        context: '',
        teamSize: '',
        businessType: '',
      }),
    ).rejects.toMatchObject({ code: 'public_intake.not_configured' });
  });

  it('files a general contact inquiry under the sender own name, marked as contact', async () => {
    const visitor = anonClient();
    await submitPublicInquiry(visitor, {
      kind: 'contact',
      name: 'Sam Ortiz',
      email: 'sam@example.test',
      topic: 'Billing',
      context: 'A question about an invoice.',
    });

    const customers = await listCustomers(target.db, { organizationId: target.organizationId });
    expect(customers.some((customer) => customer.name === 'Sam Ortiz')).toBe(true);

    const { rows } = await withConnection((pg) =>
      pg.query(
        `select payload from public.events where organization_id = $1 and payload->>'contact_name' = 'Sam Ortiz'`,
        [target.organizationId],
      ),
    );
    expect(rows[0].payload).toMatchObject({ source: 'contact', topic: 'Billing', context: 'A question about an invoice.' });
  });

  it('requires a contact inquiry to have an email and a message', async () => {
    const visitor = anonClient();
    await expect(submitPublicInquiry(visitor, { kind: 'contact', name: 'Sam', email: '', context: 'Hi' })).rejects.toMatchObject({ code: 'public_intake.email_required' });
    await expect(submitPublicInquiry(visitor, { kind: 'contact', name: 'Sam', email: 'sam@example.test', context: '  ' })).rejects.toMatchObject({ code: 'public_intake.message_required' });
  });

  it('requires a business name', async () => {
    const visitor = anonClient();
    await expect(
      submitPublicInquiry(visitor, {
      kind: 'demo',
        name: 'No Business Name',
        businessName: '   ',
        email: '',
        phone: '',
        context: '',
        teamSize: '',
        businessType: '',
      }),
    ).rejects.toMatchObject({ code: 'public_intake.name_required' });
  });

  it('rejects oversized and malformed public input before opening an anonymous session', async () => {
    const visitor = anonClient();
    await expect(
      submitPublicInquiry(visitor, {
      kind: 'demo',
        name: 'A'.repeat(201),
        businessName: 'Bounded Ltd',
        email: 'person@example.test',
        phone: '',
        context: '',
        teamSize: '',
        businessType: '',
      }),
    ).rejects.toMatchObject({ code: 'public_intake.field_too_long' });

    await expect(
      submitPublicInquiry(visitor, {
      kind: 'demo',
        name: 'A Person',
        businessName: 'Validated Ltd',
        email: 'not-an-address',
        phone: '',
        context: '',
        teamSize: '',
        businessType: '',
      }),
    ).rejects.toMatchObject({ code: 'public_intake.email_invalid' });

    expect((await visitor.auth.getUser()).data.user).toBeNull();
  });
});
