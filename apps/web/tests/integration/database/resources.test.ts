import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createResource, listResources } from '@/lib/domain/resources/resources';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Resource, the third entity to carry `custom` and the last kernel entity before Work Item.
 *
 * There is little here that Location did not already prove, and that is the point worth
 * recording: registering a third entity with the field registry costs two statements in a
 * migration and no new validator, because `app.check_custom_fields` takes the entity type as
 * an argument. The test that matters most is the one asserting a resource cannot be given a
 * field defined for a location.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHARED_NAME = 'Sam Okafor';

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

describe('resources', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('res-alice');
    bob = await newTenant('res-bob');
  });

  it('lets two tenants employ people with the same name', async () => {
    // Deliberately no unique index on name: two employees called Sam Okafor is ordinary
    // within one tenant, let alone across two. This asserts the absence is intended.
    const mine = await createResource(alice.db, {
      organizationId: alice.organizationId,
      name: SHARED_NAME,
    });
    const theirs = await createResource(bob.db, {
      organizationId: bob.organizationId,
      name: SHARED_NAME,
    });
    const alsoMine = await createResource(alice.db, {
      organizationId: alice.organizationId,
      name: SHARED_NAME,
    });

    expect(new Set([mine, theirs, alsoMine]).size).toBe(3);
  });

  it('shows each tenant only its own resources', async () => {
    const mine = await listResources(alice.db, { organizationId: alice.organizationId });
    const theirs = await listResources(bob.db, { organizationId: bob.organizationId });

    expect(mine).toHaveLength(2);
    expect(theirs).toHaveLength(1);

    const acrossTheWall = await listResources(alice.db, {
      organizationId: bob.organizationId,
    });
    expect(acrossTheWall).toEqual([]);
  });

  it('carries custom fields through the same trigger customers and locations use', async () => {
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'resource',
      key: 'payload_kg',
      label: 'Payload (kg)',
      kind: 'number',
      required: false,
    });

    await createResource(alice.db, {
      organizationId: alice.organizationId,
      name: 'Van 3',
      custom: { payload_kg: '1200' },
    });

    const resources = await listResources(alice.db, {
      organizationId: alice.organizationId,
    });
    expect(resources.find((r) => r.name === 'Van 3')?.custom.payload_kg).toBe(1200);
  });

  it('will not accept a field defined for a different entity', async () => {
    // `gate_code` belongs to locations here. If app.check_custom_fields matched on key alone
    // rather than on (organization_id, entity_type, key), a resource would accept it.
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'location',
      key: 'gate_code',
      label: 'Gate code',
      kind: 'text',
      required: false,
    });

    await expect(
      createResource(alice.db, {
        organizationId: alice.organizationId,
        name: 'Wrong Entity',
        custom: { gate_code: '4821' },
      }),
    ).rejects.toMatchObject({ code: 'fields.unknown' });

    // And the database refuses it too, for a caller that skipped the domain layer.
    const { error } = await alice.db.from('resources').insert({
      organization_id: alice.organizationId,
      name: 'Wrong Entity Direct',
      custom: { gate_code: '4821' },
      created_by: alice.userId,
    });
    expect(error!.code).toBe('23514');
  });

  it('refuses resources to a member without the capability (I12)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Resources',
      capabilities: ['role.manage', 'customer.create'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      createResource(bob.db, {
        organizationId: bob.organizationId,
        name: 'Should Not Exist',
      }),
    ).rejects.toMatchObject({ code: 'resources.forbidden' });
  });

  it('records resources on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'resource.created');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const event of data!) {
      expect(event.actor_id).toBe(alice.userId);
    }
  });
});
