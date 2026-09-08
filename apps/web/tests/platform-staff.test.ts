import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureBusiness } from '@/lib/domain/configuration/configure';
import { isPlatformStaff, listTenants } from '@/lib/domain/platform/tenants';
import { foundBusiness } from './helpers/founding';

/**
 * D28's axis: the people who run GOLD rather than a business on it.
 *
 * Every other suite here signs in as somebody scoped narrowly by construction — a member
 * through `memberships`, an outsider bound to exactly one tenant. This one signs in as the
 * opposite: a caller who is a member of nothing and must nonetheless see everything.
 *
 * **The assertion that carries the record is that writes fail on a missing privilege rather
 * than on a policy.** D28 says a platform-staff path reads what it needs and writes nothing a
 * tenant owns. A policy is the usual way to say that here and it would not be enough: the next
 * person to add a staff screen writes a policy, and a permissive one is one line. The role
 * holds no `insert`, `update` or `delete` grant on any table at all, so a permissive policy
 * would still hit `permission denied` — which is what the write tests below check for by
 * message, not merely by failure.
 *
 * **The second assertion is the one that would break everything else.** The access-token hook
 * runs for every token this project issues, so the no-op path is exercised here on purpose: an
 * ordinary member must still come back as `authenticated`. If that regressed, every other suite
 * would fail — but they would fail confusingly, and this says why in one line.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** The claims a Supabase access token actually carries, read rather than assumed. */
function claimsOf(accessToken: string): { role: string; sub: string } {
  const payload = accessToken.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

async function newUser(label: string): Promise<{ email: string; password: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return { email, password, userId: created.user.id };
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

async function signedInUser(
  label: string,
): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const { email, password, userId } = await newUser(label);
  return { db: await signIn(email, password), userId, email };
}

/**
 * Somebody who runs GOLD.
 *
 * The `platform_staff` row is written over a direct connection because **nothing in the
 * application may write it** — there is no insert policy and no grant, which is D28 declining
 * to decide what a staff *write* is. That makes this the one place in the suite where a raw
 * connection is the honest setup rather than a shortcut: it is how a colleague is actually
 * added today, and `infra/supabase/snippets/add-platform-staff.sql` is the same statement.
 *
 * The row goes in **before** the first sign-in, because the role claim is minted at sign-in.
 * Somebody promoted while signed in keeps an `authenticated` token until their next one, which
 * is ordinary session behaviour rather than anything this axis invented.
 */
async function signedInStaff(name: string): Promise<{ db: SupabaseClient; userId: string }> {
  const { email, password, userId } = await newUser('staff');

  const pg = new Client(CONNECTION);
  await pg.connect();
  await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
    userId,
    name,
  ]);
  await pg.end();

  return { db: await signIn(email, password), userId };
}

let staff: { db: SupabaseClient; userId: string };
let member: { db: SupabaseClient; userId: string; email: string };
let alphaId: string;
let betaId: string;

describe('the platform staff axis (D28)', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    // Two businesses founded by two different people, neither of whom is staff. Standing them
    // up through `configureBusiness` rather than by hand is the point of that function having
    // moved: a console over one tenant is a list with one row.
    member = await signedInUser('m5-alpha');
    const other = await signedInUser('m5-beta');

    // GOLD creates it; its own owner gives it its shape. Two acts, two sessions (D29).
    const alphaOrg = await foundBusiness({
      ownerEmail: member.email,
      name: `Alpha Groundworks ${randomUUID().slice(0, 6)}`,
      timezone: 'Europe/Amsterdam',
      currency: 'EUR',
      displayName: 'Alpha Founder',
    });
    const alpha = await configureBusiness(member.db, alphaOrg, {
      typeName: 'Hire',
      statuses: ['Reserved', 'Out'],
      transitions: [[0, 1]],
      fields: {},
      prices: [{ name: 'Excavator', unit: 'day', amountMinor: 18000 }],
      hours: [],
      roles: [],
    });
    alphaId = alpha.organizationId;

    const betaOrg = await foundBusiness({
      ownerEmail: other.email,
      name: `Beta Clinic ${randomUUID().slice(0, 6)}`,
      timezone: 'Asia/Tokyo',
      currency: 'JPY',
      displayName: 'Beta Founder',
    });
    const beta = await configureBusiness(other.db, betaOrg, {
      typeName: 'Consultation',
      statuses: ['Booked', 'Seen'],
      transitions: [[0, 1]],
      fields: {},
      prices: [{ name: 'Consultation', unit: 'appointment', amountMinor: 12000 }],
      hours: [],
      roles: [],
    });
    betaId = beta.organizationId;

    staff = await signedInStaff('Dominic');
  });

  it('puts a staff member into the platform_staff Postgres role', async () => {
    const { data } = await staff.db.auth.getSession();
    expect(claimsOf(data.session!.access_token).role).toBe('platform_staff');
  });

  it('leaves everybody else on authenticated, which is the half that could break sign-in', async () => {
    // The hook runs on every token this project issues. A no-op that stopped being one would
    // take every other suite in this directory with it.
    const { data } = await member.db.auth.getSession();
    expect(claimsOf(data.session!.access_token).role).toBe('authenticated');
  });

  it('holds no membership in any tenant, which is what makes it a fourth shape', async () => {
    // D28 rejected giving staff a membership in every tenant as "cheapest, and also the leak".
    // Staff can read `memberships` precisely so this is checkable from inside the axis.
    const { data } = await staff.db
      .from('memberships')
      .select('organization_id')
      .eq('user_id', staff.userId);

    expect(data).toEqual([]);
  });

  it('sees every tenant, including two it founded neither of', async () => {
    // **Asked about two named tenants rather than by reading the whole table**, and the
    // difference is not cosmetic. An unfiltered select returns PostgREST's first thousand rows,
    // so this assertion silently depended on the database holding fewer than a thousand
    // organizations — which is true of a fresh one and stops being true of a machine that has
    // run the suite a few hundred times. It then fails with *staff cannot see this tenant*,
    // which is the exact opposite of what has happened.
    //
    // **The claim is unchanged.** `organizations_select_staff` is `using (true)`, so what makes
    // these two visible is the role and not the row; naming them proves staff read a tenant they
    // hold no membership in, which is the whole of what this axis is. A filter is applied *after*
    // the policy, never instead of it.
    const { data, error } = await staff.db
      .from('organizations')
      .select('id')
      .in('id', [alphaId, betaId]);
    expect(error).toBeNull();

    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(alphaId);
    expect(ids).toContain(betaId);
  });

  it('sees what each tenant has switched on, and what each has been doing', async () => {
    const { data: modules } = await staff.db
      .from('organization_modules')
      .select('organization_id, module_key')
      .in('organization_id', [alphaId, betaId]);
    // Both were stood up through the same function, so both have the operational core on.
    expect((modules ?? []).some((row) => row.organization_id === alphaId)).toBe(true);
    expect((modules ?? []).some((row) => row.organization_id === betaId)).toBe(true);

    const { data: events } = await staff.db
      .from('events')
      .select('organization_id, action')
      .in('organization_id', [alphaId, betaId]);
    expect((events ?? []).some((row) => row.action === 'organization.created')).toBe(true);
  });

  it('reads nothing it was not granted, so the grant list is the boundary', async () => {
    // `customers` and `work_items` carry a tenant's actual operating data and are deliberately
    // not on the console's list. This fails on a missing privilege, not on an empty result —
    // an empty result would mean a policy declined and a wider policy would undo it.
    for (const table of ['customers', 'work_items', 'price_book_items'] as const) {
      const { error } = await staff.db.from(table).select('id');
      expect(error?.message ?? '').toContain('permission denied');
    }
  });

  it('cannot write a tenant’s data, and fails on privilege rather than on policy', async () => {
    // The assertion D28's invariant actually rests on. A policy would make these fail too, and
    // a policy is one line away from permitting them; a missing grant is not.
    const inserted = await staff.db
      .from('organizations')
      .insert({ name: 'Staff Ltd', currency: 'EUR' });
    expect(inserted.error?.message ?? '').toContain('permission denied');

    const updated = await staff.db
      .from('organizations')
      .update({ name: 'Renamed by staff' })
      .eq('id', alphaId);
    expect(updated.error?.message ?? '').toContain('permission denied');

    const deleted = await staff.db.from('organizations').delete().eq('id', alphaId);
    expect(deleted.error?.message ?? '').toContain('permission denied');

    // And the tenant's own row is untouched by all three.
    const { data } = await staff.db.from('organizations').select('name').eq('id', alphaId);
    expect(data?.[0]?.name).toContain('Alpha Groundworks');
  });

  it('cannot add itself, or anybody else, to the staff list', async () => {
    // There is no insert policy and no grant. Adding a colleague is a privileged operation
    // performed with database access, which is D28 declining to decide what a staff write is.
    const { error } = await staff.db
      .from('platform_staff')
      .insert({ user_id: staff.userId, name: 'Promoted' });

    expect(error?.message ?? '').toContain('permission denied');
  });

  it('is invisible to a tenant, who cannot see that the staff list exists', async () => {
    const { error } = await member.db.from('platform_staff').select('user_id');
    expect(error?.message ?? '').toContain('permission denied');
  });

  it('lists every tenant through the console, in each tenant’s own terms', async () => {
    const { tenants } = await listTenants(staff.db);

    const alpha = tenants.find((tenant) => tenant.id === alphaId)!;
    const beta = tenants.find((tenant) => tenant.id === betaId)!;

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    // Each business's own zone and currency travel with it. A console that rendered both in
    // one zone would be deciding what Tuesday means for somebody in Tokyo (I9), and one that
    // totalled the two currencies would be inventing a rate (I10). It does neither.
    expect(alpha.currency).toBe('EUR');
    expect(alpha.timezone).toBe('Europe/Amsterdam');
    expect(beta.currency).toBe('JPY');
    expect(beta.timezone).toBe('Asia/Tokyo');

    // What each has switched on, and the fact that something has happened there.
    expect(alpha.moduleKeys.length).toBeGreaterThan(0);
    expect(alpha.lastActivityAt).not.toBeNull();
  });

  it('newest first, so provisioning something puts it at the top', async () => {
    const { tenants } = await listTenants(staff.db);
    const times = tenants.map((tenant) => tenant.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('does not let a member reach the console view at all', async () => {
    // Two boundaries, and this is the outer one: the view is granted to `platform_staff` and
    // to nobody else, so a member is refused before any policy is consulted.
    await expect(listTenants(member.db)).rejects.toMatchObject({
      code: 'platform.tenants_failed',
    });
  });

  it('builds that view as security_invoker, so it carries no visibility of its own', async () => {
    // The inner boundary, and the one worth asserting structurally rather than by behaviour.
    // A view defaults to running as its *owner*, which would make this a service-role client
    // with extra steps — exactly what D14 refuses and D28 refuses again. `security_invoker`
    // makes it execute under the caller's own role, so every policy on `organizations`,
    // `organization_modules` and `events` still applies underneath it. Nothing about the grant
    // above would reveal if this flag were dropped, and dropping it is one word.
    const pg = new Client(CONNECTION);
    await pg.connect();
    const { rows } = await pg.query<{ reloptions: string[] | null }>(
      `select c.reloptions
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'platform_tenants'`,
    );
    await pg.end();

    expect(rows[0]?.reloptions ?? []).toContain('security_invoker=true');
  });

  it('answers the staff question from the database rather than from the session', async () => {
    // `isPlatformStaff` reads a table only the staff role may read, so the answer is a
    // policy's answer. A member gets `permission denied`, which is the correct negative rather
    // than an error worth surfacing — the domain function turns it into `false`.
    expect(await isPlatformStaff(staff.db)).toBe(true);
    expect(await isPlatformStaff(member.db)).toBe(false);
  });
});

/**
 * The fourth question, and the half of M5's criterion that was deferred to M6.
 *
 * That milestone answered three — who exists, what they have switched on, when they last did
 * anything — and left this one open with its reason written down: nothing in the schema recorded
 * a failure, so a failed-thing table would have been a table with no writer. M6 supplies the
 * writer, and these are the assertions that the reader did not quietly become something wider.
 */
describe('what is failing, on the console', () => {
  it('reads a failure across every tenant, and still writes nothing', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      // Written the way the runtime writes it — through the table directly, over a connection
      // with no session — because nothing in the application may write a run and this suite must
      // not be the exception that proves otherwise.
      await client.query(
        `insert into public.automation_runs
           (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome,
            detail)
         values ($1, gen_random_uuid(), 'A rule that broke', 'event', 'work_item',
                 gen_random_uuid(), 'failed', 'something the database said')`,
        [alphaId],
      );
    } finally {
      await client.end();
    }

    const { data, error } = await staff.db
      .from('platform_failures')
      .select('kind, organization_id, subject, detail')
      .eq('organization_id', alphaId);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data![0].subject).toBe('A rule that broke');
    // Verbatim. An interpretation here would be the console guessing at somebody else's error.
    expect(data![0].detail).toBe('something the database said');
  });

  it('cannot write a run or a delivery, and fails on privilege rather than on policy', async () => {
    // I21's second half, extended to the tables M6 added. A permissive policy written later
    // still hits a missing privilege, which is why the message is asserted and not the failure.
    const run = await staff.db.from('automation_runs').insert({
      organization_id: alphaId,
      rule_id: alphaId,
      rule_name: 'Invented by staff',
      trigger_kind: 'event',
      subject_type: 'work_item',
      subject_id: alphaId,
      outcome: 'done',
    });
    expect(run.error?.message ?? '').toContain('permission denied');

    const cleared = await staff.db
      .from('automation_runs')
      .delete()
      .eq('organization_id', alphaId);
    expect(cleared.error?.message ?? '').toContain('permission denied');
  });

  it('does not read what a business says to its own customers', async () => {
    // **Deliberately not granted.** A template is what a business says to its own customers and
    // a reading is what somebody outside said about its sites; neither is needed to know that a
    // thing failed. The console reads the fact and its cause, and does not read the mail.
    for (const table of ['message_templates', 'external_readings', 'asset_readings'] as const) {
      const { error } = await staff.db.from(table).select('id');
      expect(error?.message ?? '', table).toContain('permission denied');
    }
  });

  it('builds the failures view as security_invoker, so it carries no visibility of its own', async () => {
    // Read from `pg_class` rather than from the definition, for the reason the tenant view's own
    // test gives: dropping that flag is one word and nothing else about the view would look
    // different — and without it this becomes the service-role client D14 refuses.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select reloptions from pg_class where relname = 'platform_failures'`,
      );
      expect(rows[0].reloptions ?? []).toContain('security_invoker=true');
    } finally {
      await client.end();
    }
  });

  it('shows a member only their own business’s failures, through the same view', async () => {
    // One query and one shape for both readers, which is what stops a second idea of "failing"
    // growing on the tenant's side of the product.
    const { data, error } = await member.db
      .from('platform_failures')
      .select('organization_id');

    expect(error).toBeNull();
    expect((data ?? []).every((row) => row.organization_id === alphaId)).toBe(true);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
