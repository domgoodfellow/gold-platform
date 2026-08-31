import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createFieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createLocation,
  linkCustomerLocation,
  listLocations,
} from '@/lib/domain/locations/locations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';

/**
 * Location, and the first many-to-many in the schema.
 *
 * `customers` and `locations` are each RLS-scoped on their own. A row in
 * `customer_locations` names two entities, and RLS on that table only sees the row's own
 * organization_id — it would happily accept a customer_id belonging to somebody else. The
 * composite foreign keys are what make that row impossible to write down, and the tests
 * below go around the domain layer to prove it, because that is the path that matters.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHARED_LABEL = 'North Depot';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let alice: Tenant;
let bob: Tenant;
let aliceCustomerId: string;
let aliceLocationId: string;
let bobLocationId: string;

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

describe('locations', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('loc-alice');
    bob = await newTenant('loc-bob');

    aliceCustomerId = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Alice Customer Ltd',
    });
  });

  it('lets two tenants hold locations with the same label', async () => {
    aliceLocationId = await createLocation(alice.db, {
      organizationId: alice.organizationId,
      label: SHARED_LABEL,
      address: '1 Alice Way',
    });
    bobLocationId = await createLocation(bob.db, {
      organizationId: bob.organizationId,
      label: SHARED_LABEL,
      address: '1 Bob Street',
    });

    expect(aliceLocationId).not.toBe(bobLocationId);
  });

  it('shows each tenant only its own locations', async () => {
    const mine = await listLocations(alice.db, { organizationId: alice.organizationId });
    const theirs = await listLocations(bob.db, { organizationId: bob.organizationId });

    expect(mine.map((l) => l.address)).toEqual(['1 Alice Way']);
    expect(theirs.map((l) => l.address)).toEqual(['1 Bob Street']);

    const acrossTheWall = await listLocations(alice.db, {
      organizationId: bob.organizationId,
    });
    expect(acrossTheWall).toEqual([]);
  });

  it('links a customer to a location in the same tenant', async () => {
    await linkCustomerLocation(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      locationId: aliceLocationId,
    });

    const [location] = await listLocations(alice.db, {
      organizationId: alice.organizationId,
    });
    expect(location.customers.map((c) => c.name)).toEqual(['Alice Customer Ltd']);
  });

  it('refuses the same link twice', async () => {
    await expect(
      linkCustomerLocation(alice.db, {
        organizationId: alice.organizationId,
        customerId: aliceCustomerId,
        locationId: aliceLocationId,
      }),
    ).rejects.toMatchObject({ code: 'locations.already_linked' });
  });

  it('cannot link across tenants, even by writing the row directly', async () => {
    // Alice's own organization id, Alice's own customer, and Bob's location. RLS is
    // satisfied — the row's organization_id is hers and she has location.create — so if this
    // succeeded it would be a genuine cross-tenant reference. The composite foreign key
    // (organization_id, location_id) has no such row to point at.
    const { error } = await alice.db.from('customer_locations').insert({
      organization_id: alice.organizationId,
      customer_id: aliceCustomerId,
      location_id: bobLocationId,
      created_by: alice.userId,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23503');
  });

  it('reports the cross-tenant link as absent rather than forbidden', async () => {
    await expect(
      linkCustomerLocation(alice.db, {
        organizationId: alice.organizationId,
        customerId: aliceCustomerId,
        locationId: bobLocationId,
      }),
    ).rejects.toMatchObject({ code: 'locations.link_not_found' });
  });

  it('leaves the other tenant unable to see the link at all', async () => {
    const { data, error } = await bob.db
      .from('customer_locations')
      .select('customer_id, location_id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('carries custom fields on a location, through the same trigger customers use', async () => {
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'location',
      key: 'gate_code',
      label: 'Gate code',
      kind: 'text',
      required: false,
    });

    const id = await createLocation(alice.db, {
      organizationId: alice.organizationId,
      label: 'South Yard',
      address: '2 Alice Way',
      custom: { gate_code: '4821' },
    });
    expect(id).toBeTypeOf('string');

    const locations = await listLocations(alice.db, {
      organizationId: alice.organizationId,
    });
    expect(locations.find((l) => l.label === 'South Yard')?.custom).toEqual({
      gate_code: '4821',
    });
  });

  it('scopes a field definition to its entity type', async () => {
    // `vat_number` is defined for customers here, not for locations. If
    // app.check_custom_fields matched on key alone rather than on (organization_id,
    // entity_type, key), this would be accepted on a location.
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'vat_number',
      label: 'VAT number',
      kind: 'text',
      required: false,
    });

    await expect(
      createLocation(alice.db, {
        organizationId: alice.organizationId,
        label: 'Wrong Entity',
        address: '3 Alice Way',
        custom: { vat_number: 'GB1' },
      }),
    ).rejects.toMatchObject({ code: 'fields.unknown' });

    // And the database refuses it too, for a caller that skipped the domain layer.
    const { error } = await alice.db.from('locations').insert({
      organization_id: alice.organizationId,
      label: 'Wrong Entity Direct',
      address: '4 Alice Way',
      custom: { vat_number: 'GB1' },
      created_by: alice.userId,
    });
    expect(error!.code).toBe('23514');
  });

  it('refuses locations to a member without the capability (I12)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Locations',
      capabilities: ['role.manage', 'customer.create'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      createLocation(bob.db, {
        organizationId: bob.organizationId,
        label: 'Should Not Exist',
        address: 'Nowhere',
      }),
    ).rejects.toMatchObject({ code: 'locations.forbidden' });
  });

  it('records locations and links on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .in('action', ['location.created', 'location.linked']);

    expect(error).toBeNull();
    expect(data!.some((e) => e.action === 'location.created')).toBe(true);
    expect(data!.some((e) => e.action === 'location.linked')).toBe(true);
    for (const event of data!) {
      expect(event.actor_id).toBe(alice.userId);
    }
  });
});
