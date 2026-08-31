import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import {
  createFieldDefinition,
  listFieldDefinitions,
} from '@/lib/domain/fields/field-definitions';
import { createRole, assignRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';

/**
 * D7's registry, and the first entity to carry a `custom` column.
 *
 * Two things are being proved here. The first is I2 again, on the table where the collision
 * is most obviously ordinary: two businesses both wanting a field called `vat_number` on
 * their customers is not a conflict, and if it behaves like one the unique index has lost
 * its leading organization_id.
 *
 * The second is I17. The registry is only a registry if something enforces it, and the
 * enforcement has to be in the database — `customers` grants INSERT to authenticated, so a
 * direct PostgREST call never passes through the domain layer at all. Several tests below
 * deliberately bypass `createCustomer` for exactly that reason.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHARED_KEY = 'vat_number';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

/** Insert a customer without going through the domain layer, the way a raw RPC call would. */
async function insertCustomerDirectly(tenant: Tenant, custom: unknown) {
  return tenant.db.from('customers').insert({
    organization_id: tenant.organizationId,
    name: `Direct ${randomUUID().slice(0, 6)}`,
    custom: custom as never,
    created_by: tenant.userId,
  });
}

describe('field definitions', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('fd-alice');
    bob = await newTenant('fd-bob');
  });

  it('lets two tenants define the same field key on the same entity (I2)', async () => {
    // The whole point of the table. If field_definitions_org_entity_key_unique had been
    // written (entity_type, key) instead of leading with organization_id, the second of
    // these would fail with a bare 23505 and two businesses could never share a field name.
    const mine = await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: SHARED_KEY,
      label: 'VAT number',
      kind: 'text',
      required: false,
    });

    const theirs = await createFieldDefinition(bob.db, {
      organizationId: bob.organizationId,
      entityType: 'customer',
      key: SHARED_KEY,
      label: 'BTW-nummer',
      kind: 'text',
      required: false,
    });

    expect(mine).toBeTypeOf('string');
    expect(theirs).toBeTypeOf('string');
    expect(mine).not.toBe(theirs);
  });

  it('refuses two fields with the same key in one tenant (I2)', async () => {
    await expect(
      createFieldDefinition(alice.db, {
        organizationId: alice.organizationId,
        entityType: 'customer',
        key: SHARED_KEY,
        label: 'Duplicate',
        kind: 'text',
        required: false,
      }),
    ).rejects.toMatchObject({ code: 'fields.key_taken' });
  });

  it('shows each tenant only its own definitions', async () => {
    const mine = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });
    const theirs = await listFieldDefinitions(bob.db, {
      organizationId: bob.organizationId,
      entityType: 'customer',
    });

    expect(mine.map((d) => d.label)).toEqual(['VAT number']);
    expect(theirs.map((d) => d.label)).toEqual(['BTW-nummer']);

    // Asking for the other tenant's registry by id returns nothing rather than raising —
    // the rows are not denied, they are not there.
    const acrossTheWall = await listFieldDefinitions(alice.db, {
      organizationId: bob.organizationId,
      entityType: 'customer',
    });
    expect(acrossTheWall).toEqual([]);
  });

  it('stores a declared field on a customer', async () => {
    const id = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Declared Fields Ltd',
      custom: { [SHARED_KEY]: 'GB123456789' },
    });
    expect(id).toBeTypeOf('string');

    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    const stored = customers.find((c) => c.name === 'Declared Fields Ltd');
    expect(stored?.custom).toEqual({ [SHARED_KEY]: 'GB123456789' });
  });

  it('refuses an undeclared key from the domain, naming it', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Junk Drawer Ltd',
        custom: { not_a_field: 'whatever' },
      }),
    ).rejects.toMatchObject({ code: 'fields.unknown' });
  });

  it('refuses an undeclared key in the database, not just the domain (I17)', async () => {
    // Bypasses createCustomer entirely, which is the case that matters: the domain check
    // produces the message, app.check_custom_fields produces the guarantee.
    const { error } = await insertCustomerDirectly(alice, { not_a_field: 'whatever' });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });

  it('does not let one tenant\'s definition authorize another tenant\'s row (I17)', async () => {
    // `vat_number` is declared in BOTH organizations by now, so this proves the trigger
    // scopes its lookup by organization_id rather than asking whether the key exists
    // anywhere. Bob declares `btw_only`; Alice may not use it.
    await createFieldDefinition(bob.db, {
      organizationId: bob.organizationId,
      entityType: 'customer',
      key: 'btw_only',
      label: 'Bob only',
      kind: 'text',
      required: false,
    });

    const { error } = await insertCustomerDirectly(alice, { btw_only: 'nope' });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });

  it('refuses a value of the wrong kind', async () => {
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'seats',
      label: 'Seats',
      kind: 'number',
      required: false,
    });

    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Not A Number Ltd',
        custom: { seats: 'twelve' },
      }),
    ).rejects.toMatchObject({ code: 'fields.not_a_number' });

    // And the database refuses it too, for a caller that never passed through parseCustom.
    const { error } = await insertCustomerDirectly(alice, { seats: 'twelve' });
    expect(error!.code).toBe('23514');
  });

  it('coerces a numeric field to a number rather than storing the string', async () => {
    await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Twelve Seats Ltd',
      custom: { seats: '12' },
    });

    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    const stored = customers.find((c) => c.name === 'Twelve Seats Ltd');
    expect(stored?.custom.seats).toBe(12);
  });

  it('refuses a missing required field', async () => {
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'account_code',
      label: 'Account code',
      kind: 'text',
      required: true,
    });

    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'No Account Code Ltd',
        custom: {},
      }),
    ).rejects.toMatchObject({ code: 'fields.required' });
  });

  it('leaves customers created before a required field alone (I8)', async () => {
    // account_code became required in the previous test. Declared Fields Ltd predates it and
    // must still be readable — configuration changes are not retroactive. The trigger fires
    // on write, so this falls out of its shape rather than needing a rule of its own.
    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    const older = customers.find((c) => c.name === 'Declared Fields Ltd');

    expect(older).toBeDefined();
    expect(older!.custom.account_code).toBeUndefined();
  });

  it('refuses field management to a member without the capability (I12)', async () => {
    // A role that keeps role.manage — otherwise assign_role refuses to leave the tenant with
    // nobody able to manage roles — but loses field.manage.
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Fields',
      capabilities: ['role.manage', 'customer.create'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    // field_definitions_insert requires field.manage, so this is RLS refusing rather than
    // TypeScript. Bob is still very much a member.
    await expect(
      createFieldDefinition(bob.db, {
        organizationId: bob.organizationId,
        entityType: 'customer',
        key: 'sneaky',
        label: 'Sneaky',
        kind: 'text',
        required: false,
      }),
    ).rejects.toMatchObject({ code: 'fields.forbidden' });
  });

  it('records a defined field on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id, payload')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'field_definition.created');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const event of data!) {
      expect(event.actor_id).toBe(alice.userId);
    }
  });
});
