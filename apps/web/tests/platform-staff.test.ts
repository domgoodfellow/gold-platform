import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureBusiness } from '@/lib/domain/configuration/configure';
import { isPlatformStaff, listTenants } from '@/lib/domain/platform/tenants';
import { addMember } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';

/**
 * D28's axis: the people who run GOLD rather than a business on it.
 *
 * Every other suite here signs in as somebody scoped narrowly by construction — a member
 * through `memberships`, an outsider bound to exactly one tenant. This one signs in as the
 * opposite: a caller who reads across every tenant regardless of which, if any, they belong to.
 *
 * **Rewritten by 20260915000001.** Platform authority used to be a Postgres role a session wore
 * *instead of* `authenticated`, minted by rewriting the JWT `role` claim — which is why staff
 * used to lose their own organization memberships for as long as they held it, one sign-in
 * standing for exactly one context. That is gone. Staff now stay `authenticated` and are
 * recognised by a live table read (`app.is_platform_staff()` in a policy,
 * `app.require_platform_staff()` inside a function body), so the same identity can hold platform
 * authority and a real organization membership at once and switch between the two — see the
 * describe block below this one, which is the capability this rewrite exists to prove.
 *
 * **What the assertion had to change to, and why that is not a weaker claim.** D28 still says a
 * platform-staff path reads what it needs and writes nothing a tenant owns — that has not moved.
 * What *has* moved is which of two honest refusals a given table produces. A table staff have no
 * legitimate reason to touch at all (`memberships` inserts, `platform_staff` inserts,
 * `automation_runs` writes) still has no grant to `authenticated`, so those still fail on a
 * missing privilege, unchanged. A table ordinary tenants already read or write under
 * `authenticated` (`organizations`, `customers`, `message_templates`, and the rest) now correctly
 * treats staff the same way it treats a member of no organizations: the grant exists, so the
 * question moves to the row policy, which declines by returning nothing rather than by raising —
 * exactly how every other RLS decline in this schema already behaves for everyone else. Testing
 * for "permission denied" on those tables would now be testing for the wrong mechanism; the tests
 * below check the actual, honest outcome instead: an empty result, or zero rows changed.
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
 * added today, and `supabase/snippets/add-platform-staff.sql` is the same statement.
 *
 * The row goes in **before** the first sign-in, because the role claim is minted at sign-in.
 * Somebody promoted while signed in keeps an `authenticated` token until their next one, which
 * is ordinary session behaviour rather than anything this axis invented.
 */
async function signedInStaff(
  name: string,
): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const { email, password, userId } = await newUser('staff');

  const pg = new Client(CONNECTION);
  await pg.connect();
  await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
    userId,
    name,
  ]);
  await pg.end();

  return { db: await signIn(email, password), userId, email };
}

let staff: { db: SupabaseClient; userId: string; email: string };
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

  it('stays on authenticated, staff and ordinary member alike', async () => {
    // The one claim this whole rewrite exists to establish. Before 20260915000001 this test
    // asserted the opposite -- that staff were rewritten to a `platform_staff` role and lost the
    // `authenticated` one. There is no longer a hook, a claim, or a role to lose.
    const staffSession = await staff.db.auth.getSession();
    const memberSession = await member.db.auth.getSession();
    expect(claimsOf(staffSession.data.session!.access_token).role).toBe('authenticated');
    expect(claimsOf(memberSession.data.session!.access_token).role).toBe('authenticated');
  });

  it('holds no membership in any tenant, which is what makes it a fourth shape', async () => {
    // D28 rejected giving staff a membership in every tenant as "cheapest, and also the leak".
    // Staff can read `memberships` precisely so this is checkable from inside the axis. This
    // stays true of *this* staff fixture because nothing here ever adds one for them — it is no
    // longer true of the axis in general, which the next test proves directly.
    const { data } = await staff.db
      .from('memberships')
      .select('organization_id')
      .eq('user_id', staff.userId);

    expect(data).toEqual([]);
  });

  it('holding platform authority does not cost a real membership — the whole point of this rewrite', async () => {
    // A second staff member, added to Alpha as an ordinary member through the same door any
    // colleague would use. Before 20260915000001 this was structurally impossible to observe:
    // signing in rewrote the token's role away from `authenticated`, so a staff member's own
    // membership row existed but nothing they did while signed in could ever read under it.
    const dual = await signedInStaff('Dual-Hat');
    const [foundingRole] = await listRoles(member.db, { organizationId: alphaId });

    await addMember(member.db, {
      organizationId: alphaId,
      email: dual.email,
      displayName: 'Dominic, also staff',
      roleId: foundingRole.id,
    });

    // Reads across every tenant, exactly as before —
    const { data: crossTenant, error: crossTenantError } = await dual.db
      .from('organizations')
      .select('id')
      .in('id', [alphaId, betaId]);
    expect(crossTenantError).toBeNull();
    expect((crossTenant ?? []).map((row) => row.id).sort()).toEqual([alphaId, betaId].sort());

    // — *and* reaches Alpha's own operating data as a genuine member, in the same session, with
    // no second sign-in. This is the capability the role-swap made impossible.
    const { data: ownWork, error: ownWorkError } = await dual.db
      .from('work_items')
      .select('id')
      .eq('organization_id', alphaId);
    expect(ownWorkError).toBeNull();
    expect(ownWork).toEqual([]);

    const { data: membership, error: membershipError } = await dual.db
      .from('memberships')
      .select('organization_id, display_name')
      .eq('organization_id', alphaId)
      .eq('user_id', dual.userId);
    expect(membershipError).toBeNull();
    expect(membership?.[0]?.display_name).toBe('Dominic, also staff');

    // Still not a member of Beta, which staff-ness never grants on its own — only the
    // organization-wide staff read does, and that is a different, wider policy from membership.
    const { data: notBetaMember, error: notBetaMemberError } = await dual.db
      .from('memberships')
      .select('organization_id')
      .eq('organization_id', betaId)
      .eq('user_id', dual.userId);
    expect(notBetaMemberError).toBeNull();
    expect(notBetaMember).toEqual([]);
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

  it('sees nothing in a tenant’s own operating data, because it holds no membership there', async () => {
    // `customers`, `work_items` and `price_book_items` already grant `select` to `authenticated`
    // for their owning tenant's own members — staff hold that same base privilege now, so the
    // question is answered by the row policy rather than by the grant. A member of nothing sees
    // nothing: an empty result, cleanly, not an error.
    for (const table of ['customers', 'work_items', 'price_book_items'] as const) {
      const { data, error } = await staff.db.from(table).select('id');
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it('cannot write a tenant’s data — a missing grant where none exists, a declining policy where one does', async () => {
    // `organizations` has no insert grant to `authenticated` at all (creation happens only
    // through `create_organization`/`provision_organization`) and no delete grant either — both
    // still fail on a missing privilege, unchanged by 20260915000001.
    const inserted = await staff.db
      .from('organizations')
      .insert({ name: 'Staff Ltd', currency: 'EUR' });
    expect(inserted.error?.message ?? '').toContain('permission denied');

    const deleted = await staff.db.from('organizations').delete().eq('id', alphaId);
    expect(deleted.error?.message ?? '').toContain('permission denied');

    // `organizations` *does* grant `update (name, timezone, currency, buffer_minutes, slug)` to
    // `authenticated`, for a member with `organization.manage` to edit their own business —
    // staff hold that grant too now, so this update reaches `organizations_update`'s policy
    // rather than the privilege system, and the policy declines because staff hold no membership
    // here. No error; zero rows change.
    const updated = await staff.db
      .from('organizations')
      .update({ name: 'Renamed by staff' })
      .eq('id', alphaId);
    expect(updated.error).toBeNull();

    // The tenant's own row is untouched by all three attempts.
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
    // `platform_staff` now grants `select` to `authenticated` in full (staff need to read their
    // own listing as themselves), gated by `platform_staff_self_select`'s
    // `app.is_platform_staff()` check. An ordinary member fails that check, so the row is
    // filtered rather than the query refused — the same table is just as unreadable to them as
    // before, by a different honest mechanism.
    const { data, error } = await member.db.from('platform_staff').select('user_id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
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

  it('shows a member nothing through the console view, rather than refusing the query', async () => {
    // `platform_tenants` now grants `select` to `authenticated` (staff need to reach it as
    // themselves), so the boundary moved from the grant into the view's own body: it carries a
    // `where app.is_platform_staff()` clause precisely because `organizations` already has a
    // legitimate member-facing policy that would otherwise let a member read their own row back
    // through a view meant only for the console. A member gets an empty list, the same honest
    // "no such row for you" every other RLS decline in this schema produces — not a thrown error.
    const { tenants } = await listTenants(member.db);
    expect(tenants).toEqual([]);
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
    // `isPlatformStaff` reads `platform_staff` under the caller's own RLS, gated by
    // `app.is_platform_staff()` — a live table read, never a claim on the token. A member sees
    // no row (an empty result, not an error) and the domain function turns that into `false`.
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
    // A template is what a business says to its own customers and a reading is what somebody
    // outside said about its sites; neither is needed to know that a thing failed, and neither
    // was ever on the console's own list of concerns. These three already grant `select` to
    // `authenticated` for their owning tenant's own members, same as `customers` above — staff
    // hold that grant too now, and see nothing, because the row policy scopes it to a
    // membership they don't have. The console reads the fact and its cause, and does not read
    // the mail.
    for (const table of ['message_templates', 'external_readings', 'asset_readings'] as const) {
      const { data, error } = await staff.db.from(table).select('id');
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
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
