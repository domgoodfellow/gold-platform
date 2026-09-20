import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAsset, listAssets } from '@/lib/domain/assets/assets';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createFieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createLocation } from '@/lib/domain/locations/locations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Asset — what work is about, as opposed to Resource, which is what work is done with.
 *
 * The relationship worth testing is customer-owned equipment: an asset frequently belongs to
 * the tenant's customer rather than to the tenant, which makes `assets.customer_id` a
 * cross-entity reference and therefore another I18 surface. Work items gain an asset in this
 * slice too, so that reference is exercised as well.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  customerId: string;
  locationId: string;
  typeId: string;
  statusId: string;
  assetId: string;
};

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

  const orgId = organizationId as string;
  const customerId = await createCustomer(db, {
    organizationId: orgId,
    name: `${label} Customer`,
  });
  const locationId = await createLocation(db, {
    organizationId: orgId,
    label: `${label} Site`,
    address: `1 ${label} Way`,
  });

  // A status belongs to a type, so the type comes first.
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Service' });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    customerId,
    locationId,
    typeId,
    statusId: await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' }),
    assetId: await createAsset(db, {
      organizationId: orgId,
      name: 'Compressor',
      customerId,
      locationId,
    }),
  };
}

describe('assets', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('as-alice');
    bob = await newTenant('as-bob');
  });

  it('lets two tenants own machines with the same name', async () => {
    // Both created a "Compressor" in setup. No unique index on name, deliberately: two
    // compressors on different sites is ordinary even within one tenant.
    expect(alice.assetId).not.toBe(bob.assetId);

    const alsoMine = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Compressor',
    });
    expect(alsoMine).toBeTypeOf('string');
  });

  it('records who owns an asset and where it sits', async () => {
    const assets = await listAssets(alice.db, { organizationId: alice.organizationId });
    const owned = assets.find((a) => a.id === alice.assetId);

    expect(owned?.customer?.label).toBe('as-alice Customer');
    expect(owned?.location?.label).toBe('as-alice Site');
  });

  it('allows an asset the business owns itself, sitting nowhere', async () => {
    const id = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Portable generator',
    });

    const assets = await listAssets(alice.db, { organizationId: alice.organizationId });
    const own = assets.find((a) => a.id === id);
    expect(own?.customer).toBeNull();
    expect(own?.location).toBeNull();
  });

  it('cannot be owned by another tenant\'s customer (I18)', async () => {
    const { error } = await alice.db.from('assets').insert({
      organization_id: alice.organizationId,
      name: 'Borrowed owner',
      customer_id: bob.customerId,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23503');
  });

  it('cannot sit at another tenant\'s location (I18)', async () => {
    const { error } = await alice.db.from('assets').insert({
      organization_id: alice.organizationId,
      name: 'Borrowed site',
      location_id: bob.locationId,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23503');
  });

  it('reports a cross-tenant owner as absent rather than forbidden', async () => {
    await expect(
      createAsset(alice.db, {
        organizationId: alice.organizationId,
        name: 'Borrowed',
        customerId: bob.customerId,
      }),
    ).rejects.toMatchObject({ code: 'assets.reference_not_found' });
  });

  it('lets a work item be about an asset', async () => {
    await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Service the compressor',
      statusId: alice.statusId,
      customerId: alice.customerId,
      assetId: alice.assetId,
    });

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    const job = items.find((i) => i.title === 'Service the compressor');
    expect(job?.asset?.label).toBe('Compressor');
    // Subject, not capacity: nothing has been assigned to do it.
    expect(job?.resource).toBeNull();
  });

  it('cannot make a work item about another tenant\'s asset (I18)', async () => {
    const { error } = await alice.db.from('work_items').insert({
      organization_id: alice.organizationId,
      title: 'Borrowed subject',
      type_id: alice.typeId,
      status_id: alice.statusId,
      asset_id: bob.assetId,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23503');
  });

  it('shows each tenant only its own assets', async () => {
    const theirs = await listAssets(bob.db, { organizationId: bob.organizationId });
    expect(theirs.map((a) => a.name)).toEqual(['Compressor']);

    const acrossTheWall = await listAssets(alice.db, {
      organizationId: bob.organizationId,
    });
    expect(acrossTheWall).toEqual([]);
  });

  it('carries custom fields, scoped to assets', async () => {
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'asset',
      key: 'serial_number',
      label: 'Serial number',
      kind: 'text',
      required: false,
    });

    const id = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Boiler',
      custom: { serial_number: 'BX-99' },
    });

    const assets = await listAssets(alice.db, { organizationId: alice.organizationId });
    expect(assets.find((a) => a.id === id)?.custom).toEqual({ serial_number: 'BX-99' });

    // A resource field is not an asset field.
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'resource',
      key: 'payload_kg',
      label: 'Payload',
      kind: 'number',
      required: false,
    });
    await expect(
      createAsset(alice.db, {
        organizationId: alice.organizationId,
        name: 'Wrong entity',
        custom: { payload_kg: '1200' },
      }),
    ).rejects.toMatchObject({ code: 'fields.unknown' });
  });

  it('refuses assets to a member without the capability (I12)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Assets',
      capabilities: ['role.manage', 'customer.create'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      createAsset(bob.db, {
        organizationId: bob.organizationId,
        name: 'Should not exist',
      }),
    ).rejects.toMatchObject({ code: 'assets.forbidden' });
  });

  it('records assets on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'asset.created');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const event of data!) {
      expect(event.actor_id).toBe(alice.userId);
    }
  });
});
