import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';

/**
 * Customer is the first genuinely tenant-owned entity, so this is where the failure
 * constraints.md names gets its regression test:
 *
 *   > Its `customers_email_unique` is global too, so two tenants could never share a
 *   > customer email address.
 *
 * Two businesses serving the same person is ordinary. If SHARED_EMAIL ever fails for the
 * second tenant, the unique index has lost its leading organization_id.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHARED_EMAIL = `shared-${randomUUID().slice(0, 8)}@example.test`;

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

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Founder',
  });
  if (error) throw error;

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

describe('customers', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('alice');
    bob = await newTenant('bob');
  });

  it('lets two tenants hold the same customer email address (I2)', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Shared Person',
        email: SHARED_EMAIL,
      }),
    ).resolves.toBeTypeOf('string');

    // The assertion the prior repo would have failed.
    await expect(
      createCustomer(bob.db, {
        organizationId: bob.organizationId,
        name: 'Shared Person',
        email: SHARED_EMAIL,
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses the same email twice within one tenant', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Shared Person Again',
        email: SHARED_EMAIL.toUpperCase(),
      }),
    ).rejects.toMatchObject({ code: 'customers.email_taken' });
  });

  it('shows each tenant only its own customers (I1)', async () => {
    const forAlice = await listCustomers(alice.db, { organizationId: alice.organizationId });
    const forBob = await listCustomers(bob.db, { organizationId: bob.organizationId });

    expect(forAlice).toHaveLength(1);
    expect(forBob).toHaveLength(1);
    expect(forAlice[0].id).not.toBe(forBob[0].id);
  });

  it('returns nothing when asked for another tenant by id (I1)', async () => {
    const stolen = await listCustomers(alice.db, { organizationId: bob.organizationId });
    expect(stolen).toEqual([]);
  });

  it('refuses to create a customer inside another tenant (I1)', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: bob.organizationId,
        name: 'Trojan',
        email: `trojan-${randomUUID().slice(0, 8)}@example.test`,
      }),
    ).rejects.toMatchObject({ code: 'customers.create_failed' });

    const forBob = await listCustomers(bob.db, { organizationId: bob.organizationId });
    expect(forBob.map((c) => c.name)).not.toContain('Trojan');
  });

  it('writes a timeline event attributable to its author (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('actor_id, entity_type, entity_id, action')
      .eq('entity_type', 'customer');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].actor_id).toBe(alice.userId);
    expect(data![0].action).toBe('customer.created');
  });

  it('rolls the event back with the customer when creation fails', async () => {
    const before = await alice.db.from('events').select('id').eq('entity_type', 'customer');

    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Doomed',
        email: SHARED_EMAIL,
      }),
    ).rejects.toBeInstanceOf(Error);

    const after = await alice.db.from('events').select('id').eq('entity_type', 'customer');
    expect(after.data).toHaveLength(before.data!.length);
  });

  it('rejects a nameless customer in the domain, before the database', async () => {
    await expect(
      createCustomer(alice.db, { organizationId: alice.organizationId, name: '   ' }),
    ).rejects.toMatchObject({ code: 'customers.name_required' });
  });
});
