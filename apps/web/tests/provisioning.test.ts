import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { listTenants } from '@/lib/domain/platform/tenants';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { getOrganization, listMyOrganizations } from '@/lib/domain/tenancy/organizations';

/**
 * The operator door (D29): GOLD creates a business and hands it to its owner.
 *
 * **What this suite is really about is the line I21 now sits on.** D28 gave platform staff a
 * role that reads everything and writes nothing, and provisioning is the first thing staff must
 * write — so the question is not *may staff write* but *what may they write*. The answer here
 * is: a tenant that did not exist when the call began, and nothing else, ever. The two halves
 * are asserted together on purpose, because either alone is misleading — that staff can
 * provision proves nothing about containment, and that staff cannot write proves nothing if
 * they cannot provision either.
 *
 * **The second thing it asserts is that there is one creation path and not two.** D29's whole
 * correction is that provisioned and self-served are two doors rather than two kinds of tenant,
 * and a claim like that decays silently: the doors drift, one gains a default the other lacks,
 * and a year later a provisioned business is subtly a different product. So the last test
 * builds one business through each door and compares what came out.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const STAFF_NAME = 'Dominic at GOLD';

async function newUser(label: string) {
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

/**
 * As in `platform-staff.test.ts`: the row goes in before the first sign-in, because the role
 * claim is minted at sign-in and promotion does not refresh it.
 */
async function signedInStaff() {
  const { email, password, userId } = await newUser('staff');
  const pg = new Client(CONNECTION);
  await pg.connect();
  await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
    userId,
    STAFF_NAME,
  ]);
  await pg.end();
  return { db: await signIn(email, password), userId, email };
}

async function signedInUser(label: string) {
  const { email, password, userId } = await newUser(label);
  return { db: await signIn(email, password), userId, email };
}

type Person = Awaited<ReturnType<typeof signedInUser>>;

let staff: Awaited<ReturnType<typeof signedInStaff>>;
let owner: Person;
let stranger: Person;

describe('the operator door (D29)', () => {
  beforeAll(async () => {
    staff = await signedInStaff();
    owner = await signedInUser('owner');
    stranger = await signedInUser('stranger');
  });

  it('hands a business to somebody who is not the person who created it', async () => {
    const id = await provisionOrganization(staff.db, {
      ownerEmail: owner.email,
      name: 'Northern Plant Services',
      displayName: 'Sam Okafor',
      timezone: 'Europe/Amsterdam',
      currency: 'EUR',
    });

    // The owner has it, named as the business names them (D19).
    const theirs = await getOrganization(owner.db, id);
    expect(theirs).toMatchObject({
      name: 'Northern Plant Services',
      currency: 'EUR',
      timezone: 'Europe/Amsterdam',
    });
    expect(theirs?.capabilities).toEqual(expect.arrayContaining([...ALL_CAPABILITIES]));

    // And the staff member does not, which is the half D28 rejected `memberships` over: our
    // people are not in a customer's own list of who works at their business.
    //
    // `null` rather than a thrown error matters beyond this assertion: `requireOrganization`
    // turns only null into `notFound()`, so a staff member who types a tenant URL gets the same
    // 404 a stranger gets. It reached that state by 500ing until `getOrganization` learned that
    // insufficient_privilege means "not yours" — which for this role is exactly what it means,
    // because staff hold no `select` on `roles`.
    expect(await getOrganization(staff.db, id)).toBeNull();
    expect(await listMyOrganizations(staff.db)).toEqual([]);
  });

  it('leaves no GOLD user id anywhere in the business own rows', async () => {
    const id = await provisionOrganization(staff.db, {
      ownerEmail: owner.email,
      name: 'Handed Over Ltd',
      displayName: 'Sam',
      currency: 'GBP',
    });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      // `created_by` on all three founding rows is the owner. A staff id here would put a GOLD
      // employee inside the customer's data for no reason a customer could ever act on.
      const rows = await pg.query(
        `select o.created_by as org, r.created_by as role, m.created_by as membership, m.user_id
           from public.organizations o
           join public.roles r on r.organization_id = o.id
           join public.memberships m on m.organization_id = o.id
          where o.id = $1`,
        [id],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toEqual({
        org: owner.userId,
        role: owner.userId,
        membership: owner.userId,
        user_id: owner.userId,
      });

      // Exactly one member: the owner. Nobody was quietly added alongside them.
      const members = await pg.query(
        'select count(*)::int as n from public.memberships where organization_id = $1',
        [id],
      );
      expect(members.rows[0].n).toBe(1);
    } finally {
      await pg.end();
    }
  });

  it('records that GOLD did it, under the same action either door writes', async () => {
    const id = await provisionOrganization(staff.db, {
      ownerEmail: owner.email,
      name: 'Recorded Ltd',
      displayName: 'Sam',
      currency: 'CAD',
    });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const events = await pg.query(
        `select actor_id, action, payload from public.events
          where organization_id = $1 and entity_type = 'organization'`,
        [id],
      );
      expect(events.rows).toHaveLength(1);

      // The same action through either door — D29's correction as a row. A timeline reader
      // filtering on the action keeps working; one asking how a business arrived reads the
      // payload.
      expect(events.rows[0].action).toBe('organization.created');
      expect(events.rows[0].actor_id).toBe(staff.userId);
      expect(events.rows[0].payload).toMatchObject({
        provisioned: true,
        provisioned_by: STAFF_NAME,
        owner_email: owner.email.toLowerCase(),
      });
    } finally {
      await pg.end();
    }
  });

  it('switches on the operational core and nothing that publishes', async () => {
    const id = await provisionOrganization(staff.db, {
      ownerEmail: owner.email,
      name: 'Default Modules Ltd',
      displayName: 'Sam',
      currency: 'USD',
    });

    const tenants = await listTenants(staff.db);
    const provisioned = tenants.find((tenant) => tenant.id === id);

    // **`billing` alone, and that is the whole list** — `20260829000012` took the kernel out
    // of the module table, so work, scheduling and customers are not modules to switch on
    // (D25). Deliberately absent: `booking` and `portal`, because publishing a business to the
    // internet is not something GOLD does on somebody's behalf at the moment of handover.
    // Asserted through the same `enable_default_modules` the other door calls, so the two
    // cannot drift apart.
    expect(provisioned?.moduleKeys).toEqual(['billing']);
  });

  it('still cannot reach into a business once it exists, which is where I21 now sits', async () => {
    const id = await provisionOrganization(staff.db, {
      ownerEmail: owner.email,
      name: 'Not Ours Ltd',
      displayName: 'Sam',
      currency: 'EUR',
    });

    // Created by this very caller, one line ago, and still unreachable for writing. The
    // distinction the whole axis rests on: a missing privilege, not a policy declining.
    const renamed = await staff.db
      .from('organizations')
      .update({ name: 'Ours Now' })
      .eq('id', id);
    expect(renamed.error?.message).toMatch(/permission denied/i);

    const joined = await staff.db.from('memberships').insert({
      organization_id: id,
      user_id: staff.userId,
      display_name: 'Support',
    });
    expect(joined.error?.message).toMatch(/permission denied/i);

    // The business is untouched by either attempt.
    expect((await getOrganization(owner.db, id))?.name).toBe('Not Ours Ltd');
  });

  it('is not executable by a member, or by anybody who is not staff', async () => {
    await expect(
      provisionOrganization(stranger.db, {
        ownerEmail: stranger.email,
        name: 'Self Dealt Ltd',
        displayName: 'Me',
        currency: 'EUR',
      }),
    ).rejects.toMatchObject({ code: 'platform.provision_failed' });

    // The refusal is the grant rather than the function's own check: `authenticated` holds no
    // execute on it at all, so a stranger never reaches the scope check inside.
    const direct = await stranger.db.rpc('provision_organization', {
      p_owner_email: stranger.email,
      p_name: 'Self Dealt Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Me',
      p_timezone: 'UTC',
      p_currency: 'EUR',
    });
    expect(direct.error).not.toBeNull();
  });

  it('fails loudly on an owner with no account, rather than making a business nobody can reach', async () => {
    await expect(
      provisionOrganization(staff.db, {
        ownerEmail: `ghost-${randomUUID().slice(0, 8)}@example.test`,
        name: 'Unreachable Ltd',
        displayName: 'Nobody',
        currency: 'EUR',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('has an account yet') });

    // The precondition is the same one `addMember` states, and the failure it prevents is the
    // one `add-platform-staff.sql` was fixed for: a tenant created with no member is a row
    // nobody can ever reach again.
    expect(
      (await listTenants(staff.db)).some((tenant) => tenant.name === 'Unreachable Ltd'),
    ).toBe(false);
  });

  it('is the only door: self-serve founding is shut in the database, not on a screen', async () => {
    // **This test replaced one that walked through both doors.** Until D29 closed founding, it
    // stood a business up each way and compared what came out, because "two doors onto one
    // creation path" was a claim that could decay quietly. The claim is now enforced instead of
    // asserted: there is one path, and the other is a function nobody may execute.
    const { error } = await stranger.db.rpc('create_organization', {
      p_name: 'Self Founded Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Me',
      p_timezone: 'UTC',
      p_currency: 'EUR',
    });

    // `permission denied`, not a policy declining and not a form that is missing. A route is
    // not the authorization boundary and neither is an absent button (I12); this is the
    // refusal that survives somebody calling PostgREST directly.
    expect(error?.message).toMatch(/permission denied/i);

    // Staff hold no execute on it either. The door is shut, rather than moved to our side.
    const asStaff = await staff.db.rpc('create_organization', {
      p_name: 'Staff Founded Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Me',
      p_timezone: 'UTC',
      p_currency: 'EUR',
    });
    expect(asStaff.error?.message).toMatch(/permission denied/i);
  });

  it('will not hand a business to an anonymous account', async () => {
    // `create_organization` has carried this guard since 20260830000001 and can no longer be
    // reached to prove it, so the rule is asserted here, at the door that is open. An anonymous
    // session is a real `auth.users` row with a real `auth.uid()` (D22) — which is exactly why
    // it would otherwise pass for an owner.
    const visitor = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signedIn, error: signInError } = await visitor.auth.signInAnonymously();
    expect(signInError).toBeNull();
    expect(signedIn.user?.is_anonymous).toBe(true);

    // Asked by email, and an anonymous user has none — so the refusal that actually fires is
    // "no account with that address". Asserted by id instead, through the RPC, so the guard
    // itself is what is being tested rather than the lookup in front of it.
    const { error } = await staff.db.rpc('provision_organization', {
      p_owner_email: signedIn.user?.email ?? '',
      p_name: 'Ghost Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Nobody',
      p_timezone: 'UTC',
      p_currency: 'EUR',
    });
    expect(error).not.toBeNull();
  });
});
