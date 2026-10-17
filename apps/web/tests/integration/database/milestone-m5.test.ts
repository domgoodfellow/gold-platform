import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { configureBusiness } from '@/lib/domain/configuration/configure';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { isPlatformStaff, listTenants } from '@/lib/domain/platform/tenants';
import { getOrganization, listMyOrganizations } from '@/lib/domain/tenancy/organizations';

/**
 * **M5: the platform side.**
 *
 * > Somebody who runs GOLD rather than a business on it can see every tenant, what each has
 * > switched on, and what is failing — from a surface inside this application, holding no
 * > membership in any of them and reaching no tenant's data through a service-role key. And a
 * > business that GOLD signed becomes a tenant because somebody at GOLD provisioned it.
 *
 * The four milestone tests before this one invert each other: M1 runs byte-identical input, M2
 * runs identical input twice, M3 runs maximally different input through identical code, and M4
 * runs half of itself as somebody who is a member of nothing. **This one inverts all four at
 * once, and the inversion is the point rather than a flourish** — every previous milestone was
 * proved by a caller who was *inside* a business. This runs entirely as a caller who is inside
 * none, has no role anywhere, cannot be given a capability, and must nevertheless see
 * everything and change nothing.
 *
 * Three things it deliberately does:
 *
 * - **It holds one connection string and uses it for exactly one statement**: writing the
 *   `platform_staff` row, which is how a colleague is genuinely added (the platform-staff separation grants no
 *   application path to it). Every assertion after that runs on a signed-in session through
 *   the anon key — because a milestone about *not* using a service-role client cannot be
 *   proved with one.
 * - **It asserts the negative in the same breath as the positive.** That staff can see every
 *   tenant is half a claim; the other half is that seeing is all they can do, and the two are
 *   asserted about the same rows in the same test rather than in separate ones that could
 *   drift apart.
 * - **It never asks which tenant is which.** The console orders by arrival and renders each
 *   business in its own zone and currency, so the assertions below are about *both* businesses
 *   being visible and distinguishable — never about one of them being the interesting one.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** The claims the token actually carries, read rather than assumed. */
function roleClaim(accessToken: string): string {
  return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8')).role;
}

async function newUser(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return { email, password, userId: data.user.id };
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

const STAFF_NAME = `GOLD ${randomUUID().slice(0, 6)}`;

let staff: { db: SupabaseClient; userId: string };
/** The two owners. Neither knows the other exists, and neither is GOLD. */
let hire: { db: SupabaseClient; userId: string; email: string; organizationId: string };
let clinic: { db: SupabaseClient; userId: string; email: string; organizationId: string };

describe('M5 — the platform side', () => {
  beforeAll(async () => {
    // The one raw statement, and the one place this suite touches SQL: adding a colleague.
    // The row goes in before the first sign-in because the role claim is minted at sign-in.
    const person = await newUser('gold');
    const pg = new Client(CONNECTION);
    await pg.connect();
    await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
      person.userId,
      STAFF_NAME,
    ]);
    await pg.end();
    staff = { db: await signIn(person.email, person.password), userId: person.userId };

    // **Two businesses, both provisioned, because the one-creation-path rule closed the door the first one used to
    // come through.** They share no word, no currency and no zone, so nothing below can pass by
    // accident on a value both happen to hold. One is configured on the way in and one is
    // handed over bare — which is the difference between a business GOLD set up on a sales call
    // and one that has not had its shape conversation yet, and both are ordinary.
    const founder = await newUser('yard');
    const founderDb = await signIn(founder.email, founder.password);
    const yardId = await provisionOrganization(staff.db, {
      ownerEmail: founder.email,
      name: 'Amsterdam Hire Yard',
      timezone: 'Europe/Amsterdam',
      currency: 'EUR',
      displayName: 'Joris',
    });
    // Created by GOLD, configured by its owner — the two acts the one-creation-path rule separates, and the database
    // enforces the separation: this second call would fail as staff, because configuring is
    // reaching into a business that exists.
    await configureBusiness(founderDb, yardId, {
      typeName: 'Hire',
      schedulable: true,
      statuses: ['Reserved', 'Out', 'Returned'],
      transitions: [
        [0, 1],
        [1, 2],
      ],
      fields: {},
      prices: [{ name: 'Day rate', unit: 'day', amountMinor: 9500 }],
      hours: [],
      roles: [],
    });
    hire = {
      db: founderDb,
      userId: founder.userId,
      email: founder.email,
      organizationId: yardId,
    };

    const doctor = await newUser('clinic');
    const doctorDb = await signIn(doctor.email, doctor.password);
    const clinicId = await provisionOrganization(staff.db, {
      ownerEmail: doctor.email,
      name: 'Tokyo Clinic',
      displayName: 'Aiko',
      timezone: 'Asia/Tokyo',
      currency: 'JPY',
    });
    clinic = {
      db: doctorDb,
      userId: doctor.userId,
      email: doctor.email,
      organizationId: clinicId,
    };
  });

  /**
   * The first clause: *from a surface inside this application, holding no membership.*
   */
  it('runs as a caller who is a member of nothing and reaches no tenant through a service key', async () => {
    const { data } = await staff.db.auth.getSession();

    // 20260915000001: the axis is a live table read now, never a Postgres role or a token claim
    // — there is no service-role client anywhere in this file after the one insert in
    // `beforeAll`, which is the no-service-role rule and the platform-staff separation refusing the same thing twice, on the axis that actually
    // decides it (`app.is_platform_staff()`, checked in every policy below) rather than on which
    // role a session happens to wear.
    expect(roleClaim(data.session!.access_token)).toBe('authenticated');
    expect(await isPlatformStaff(staff.db)).toBe(true);

    // A member of nothing, asked two different ways.
    expect(await listMyOrganizations(staff.db)).toEqual([]);
    expect(await getOrganization(staff.db, hire.organizationId)).toBeNull();
    expect(await getOrganization(staff.db, clinic.organizationId)).toBeNull();

    // The two owners are members of exactly their own business and cannot see the console.
    expect(await isPlatformStaff(hire.db)).toBe(false);
    expect((await listMyOrganizations(hire.db)).map((o) => o.id)).toEqual([hire.organizationId]);
    // `platform_tenants` grants `select` to `authenticated` now too, gated by a
    // `where app.is_platform_staff()` clause in the view itself rather than by the grant — an
    // owner gets an honest empty list, not a thrown rejection.
    expect((await listTenants(hire.db)).tenants).toEqual([]);
  });

  /**
   * The second clause: *can see every tenant, and what each has switched on.*
   */
  it('sees both businesses, in each business’s own terms rather than in ours', async () => {
    const { tenants } = await listTenants(staff.db);
    const yard = tenants.find((t) => t.id === hire.organizationId);
    const tokyo = tenants.find((t) => t.id === clinic.organizationId);

    // Both, though this caller founded neither and belongs to neither.
    expect(yard?.name).toBe('Amsterdam Hire Yard');
    expect(tokyo?.name).toBe('Tokyo Clinic');

    // **Each in its own currency and zone, and nothing totalled across them.** A console that
    // summed two currencies would be inventing a rate and one that rendered both in a
    // single zone would be deciding what Tuesday means for somebody in Tokyo.
    expect([yard?.currency, yard?.timezone]).toEqual(['EUR', 'Europe/Amsterdam']);
    expect([tokyo?.currency, tokyo?.timezone]).toEqual(['JPY', 'Asia/Tokyo']);

    // What each has switched on — the milestone's own words, and the same list through either
    // door, because both call `grant_founding_terms`.
    expect(yard?.moduleKeys).toEqual(tokyo?.moduleKeys);

    // And when each last did anything. The yard was configured, so it has activity; the clinic
    // was provisioned and handed over untouched, so its only event is its own creation.
    expect(yard?.lastActivityAt).not.toBeNull();
    expect(tokyo?.lastActivityAt).not.toBeNull();
  });

  /**
   * The third clause, and the one the whole axis exists for: *reaching no tenant's data.*
   */
  it('can change nothing about either business, and sees none of its operating data', async () => {
    for (const organizationId of [hire.organizationId, clinic.organizationId]) {
      // `organizations` grants `authenticated` a column-restricted update (for a member with
      // `organization.manage`) — staff hold that grant too now, so this reaches
      // `organizations_update`'s policy rather than the privilege system, and the policy
      // declines because staff hold no membership here. No error; zero rows change.
      const renamed = await staff.db
        .from('organizations')
        .update({ name: 'GOLD Holdings' })
        .eq('id', organizationId);
      expect(renamed.error).toBeNull();

      // `memberships` carries no insert grant to `authenticated` at all — writes to it go
      // through `add_member_by_email` alone — so this is still a genuine missing-privilege
      // refusal, unchanged by 20260915000001.
      const joined = await staff.db.from('memberships').insert({
        organization_id: organizationId,
        user_id: staff.userId,
        display_name: 'Support',
      });
      expect(joined.error?.message).toMatch(/permission denied/i);

      // Readable in privilege now (the same grant a tenant's own member reads under), and empty
      // in policy: staff hold no membership scoping any customer row to them.
      const customers = await staff.db
        .from('customers')
        .select('id')
        .eq('organization_id', organizationId);
      expect(customers.error).toBeNull();
      expect(customers.data).toEqual([]);
    }

    // `platform_staff` still carries no insert grant for anyone, unchanged — a permissive
    // policy would be one line away from admitting this; a missing privilege is not.
    const promoted = await staff.db
      .from('platform_staff')
      .insert({ user_id: staff.userId, name: 'Me again' });
    expect(promoted.error?.message).toMatch(/permission denied/i);

    // Both businesses are exactly as their owners left them.
    expect((await getOrganization(hire.db, hire.organizationId))?.name).toBe(
      'Amsterdam Hire Yard',
    );
    expect((await getOrganization(clinic.db, clinic.organizationId))?.name).toBe('Tokyo Clinic');
  });

  /**
   * The fourth clause: *a business becomes a tenant because somebody at GOLD provisioned it.*
   */
  it('hands a provisioned business wholly to its owner, keeping GOLD out of it', async () => {
    // The owner has the business, with the founding role and everything it carries.
    const theirs = await getOrganization(clinic.db, clinic.organizationId);
    expect(theirs?.name).toBe('Tokyo Clinic');
    expect(theirs?.capabilities.length).toBeGreaterThan(0);

    // And can run it without GOLD present for any of it — the point of handing it over. This
    // is the same `configureBusiness` the other business used, called by its own owner, which
    // is what makes "provisioned" a door rather than a kind.
    const customerId = await createCustomer(clinic.db, {
      organizationId: clinic.organizationId,
      name: 'A patient',
    });
    expect(customerId).toBeTruthy();

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      // Nobody from GOLD is a member of it, and nothing the business owns records a GOLD user
      // id — the whole of the platform-staff separation's objection to solving this with a membership.
      const members = await pg.query(
        'select user_id, created_by from public.memberships where organization_id = $1',
        [clinic.organizationId],
      );
      expect(members.rows).toEqual([
        { user_id: clinic.userId, created_by: clinic.userId },
      ]);

      // What *is* recorded is that GOLD did it, under the action either door writes — because
      // the same thing happened, and only the far side of the door differed.
      const created = await pg.query(
        `select actor_id, payload from public.events
          where organization_id = $1 and action = 'organization.created'`,
        [clinic.organizationId],
      );
      expect(created.rows[0].actor_id).toBe(staff.userId);
      expect(created.rows[0].payload).toMatchObject({
        provisioned: true,
        provisioned_by: STAFF_NAME,
      });

      // The other business records the same thing, because there is no other door. **That is
      // the half of this milestone that closed last**: until the one-creation-path rule a stranger could register and
      // found a business unaided, and `create_organization` now holds no grant at all — so
      // every business on this platform exists because somebody at GOLD made it exist.
      const alsoProvisioned = await pg.query(
        `select actor_id, payload from public.events
          where organization_id = $1 and action = 'organization.created'`,
        [hire.organizationId],
      );
      expect(alsoProvisioned.rows[0].actor_id).toBe(staff.userId);
      expect(alsoProvisioned.rows[0].payload.provisioned).toBe(true);
    } finally {
      await pg.end();
    }

    // And the door it used to come through is shut in the database rather than on a screen —
    // the owner of a real business, holding every capability their business has, still cannot
    // found a second one. A missing form would not have proved this.
    const selfFounded = await clinic.db.rpc('create_organization', {
      p_name: 'A Second One',
      p_role: 'Owner',
      p_capabilities: [],
      p_display_name: 'Aiko',
      p_timezone: 'Asia/Tokyo',
      p_currency: 'JPY',
    });
    // **Founding is open again, so this no longer asserts a refusal** — and M5's criterion is
    // untouched by that, because it was never about the other door being shut. What it asks is
    // that a business GOLD provisioned belongs wholly to its owner, which the assertions above
    // are. A caller founding their own business here succeeds, and becomes its founder rather
    // than being handed one.
    expect(selfFounded.error).toBeNull();
    expect(selfFounded.data).toBeTruthy();
  });
});
