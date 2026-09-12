import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { listTenants } from '@/lib/domain/platform/tenants';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import {
  createOrganization,
  getOrganization,
  listMyOrganizations,
  setTradingCurrency,
} from '@/lib/domain/tenancy/organizations';

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

    const { tenants } = await listTenants(staff.db);
    const provisioned = tenants.find((tenant) => tenant.id === id);

    // **`billing` and `drafting`, and that is the whole list** — `20260829000012` took the
    // kernel out of the module table, so work, scheduling and customers are not modules to
    // switch on (D25), and `20260904000001` added guided setup because a first-run screen that
    // has to be found in settings is not a first-run screen. Deliberately absent: `booking` and
    // `portal`, because publishing a business to the internet is not something GOLD does on
    // somebody's behalf at the moment of handover.
    //
    // **Asserted at this door precisely because it is the other one.** Both doors call
    // `enable_default_modules`, so a change made for the person who signs up reaches the
    // business GOLD hands over as well — and if the two ever stopped agreeing, this line is
    // where it would show.
    expect(provisioned?.moduleKeys).toEqual(['billing', 'drafting']);
  });

  it('still cannot reach into a business once it exists, which is where I21 now sits', async () => {
    const id = await provisionOrganization(staff.db, {
      ownerEmail: owner.email,
      name: 'Not Ours Ltd',
      displayName: 'Sam',
      currency: 'EUR',
    });

    // Created by this very caller, one line ago, and still unreachable for writing. Two
    // different refusals now, and both are I21 -- 20260915000001 stopped staff wearing a
    // separate Postgres role, so `organizations`'s ordinary member-facing update grant applies to
    // them too; what refuses them is `organizations_update`'s policy declining because they hold
    // no membership here, not a missing privilege. `memberships` carries no insert grant to
    // `authenticated` at all -- writes to it go through `add_member_by_email` alone -- so that
    // half is still a genuine missing-privilege refusal, unchanged.
    const renamed = await staff.db
      .from('organizations')
      .update({ name: 'Ours Now' })
      .eq('id', id);
    // No error at all -- a policy decline is a silent zero-row match, not a thrown refusal. The
    // name-check after both attempts is the actual proof, not this line.
    expect(renamed.error).toBeNull();

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

    // The refusal used to be the grant alone -- `authenticated` held no execute on this function
    // at all, so a stranger never reached the scope check inside. 20260915000001 widened that
    // grant (staff needed to call it as `authenticated`, once being staff stopped being a
    // separate Postgres role) and leaned instead on the function's own inline check, the same
    // shape `app.require_platform_staff()` formalises elsewhere. The refusal still happens; it
    // now happens one line further in.
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
    expect(direct.error?.message ?? '').toMatch(/platform staff/i);
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
      (await listTenants(staff.db)).tenants.some((tenant) => tenant.name === 'Unreachable Ltd'),
    ).toBe(false);
  });

  it('is one of two doors, and both of them work', async () => {
    // **This walks through both doors again**, which is what it did before founding was closed
    // and what it has to do now that both are open. "Two doors onto one creation path" is a
    // claim that decays quietly, so it is asserted rather than assumed: the same business comes
    // out either way, and only the record of how it arrived differs.
    const selfFounded = await createOrganization(stranger.db, {
      name: 'Self Founded Ltd',
      displayName: 'Me',
      timezone: 'UTC',
      currency: 'EUR',
    });
    expect(selfFounded).toBeTruthy();

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `select actor_id, payload from public.events
          where organization_id = $1 and action = 'organization.created'`,
        [selfFounded],
      );

      // **The same action, which is what makes them two doors rather than two kinds of tenant.**
      // A reader filtering on the action keeps working; one asking how a business arrived reads
      // the payload, where this door records nothing about provisioning because nobody
      // provisioned it.
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_id).toBe(stranger.userId);
      expect(rows[0].payload.provisioned).toBeUndefined();

      // And the founder is a member of their own business, holding the founding role — the one
      // thing `provision_organization` cannot express, because it names an owner who is somebody
      // else.
      const members = await pg.query(
        'select user_id, created_by from public.memberships where organization_id = $1',
        [selfFounded],
      );
      expect(members.rows).toEqual([
        { user_id: stranger.userId, created_by: stranger.userId },
      ]);
    } finally {
      await pg.end();
    }
  });

  it('lets somebody sign up without saying what they trade in, and refuses the first amount until they do', async () => {
    // **Signing up asks two questions and a currency is not one of them** (`20260904000001`).
    // The screen a person meets is about who they are and what the business is called; a
    // currency is a fact about money, and nothing here is about money yet.
    const id = await createOrganization(stranger.db, {
      name: 'Not Priced Yet Ltd',
      displayName: 'Me',
      timezone: 'UTC',
    });

    // **Null, not a default.** This is the whole point of the column becoming nullable: the
    // previous shape was `not null default 'EUR'`, so a business that was never asked was
    // silently recorded as trading in euro — the platform deciding what a business trades in
    // through a column default, which is exactly what the raise one level up existed to stop.
    const fresh = await getOrganization(stranger.db, id);
    expect(fresh?.currency).toBeNull();

    // And nothing invents one on the way to the first amount. The refusal is the database's,
    // in a sentence an operator can act on, rather than a not-null violation from a column
    // three joins away.
    await expect(
      createPriceBookItem(stranger.db, {
        organizationId: id,
        name: 'Call out',
        unit: 'visit',
        unitAmountMinor: 4500,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('has not said what it trades in') });

    // Answered where it is first needed, and then the same write goes through. `20260904000001`
    // moved the question rather than removing it.
    await setTradingCurrency(stranger.db, { organizationId: id, currency: 'SEK' });
    expect((await getOrganization(stranger.db, id))?.currency).toBe('SEK');

    const itemId = await createPriceBookItem(stranger.db, {
      organizationId: id,
      name: 'Call out',
      unit: 'visit',
      unitAmountMinor: 4500,
    });
    expect(itemId).toBeTruthy();

    // **Asked once and never again.** Re-answering is a settings act with consequences for a
    // catalogue already priced, and this path is for a business that has said nothing at all —
    // so it refuses rather than quietly becoming a second way to change what a business trades
    // in.
    await expect(
      setTradingCurrency(stranger.db, { organizationId: id, currency: 'NOK' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('already said') });
  });

  it('refuses an anonymous session at the door that is open', async () => {
    // The guard that was found the expensive way, and the reason the function was never
    // dropped while the grant was revoked. An anonymous visitor from the booking flow arrives
    // on the same `authenticated` role as anybody who registered — so a grant is not the thing
    // telling them apart, and this is.
    const visitor = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await visitor.auth.signInAnonymously();
    if (signInError) throw signInError;

    const { error } = await visitor.rpc('create_organization', {
      p_name: 'Passing Through Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Nobody',
      p_timezone: 'UTC',
      p_currency: 'EUR',
    });

    expect(error?.message).toContain('anonymous session may not create an organization');
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
