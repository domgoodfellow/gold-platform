import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createFieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createLocation } from '@/lib/domain/locations/locations';
import { createResource } from '@/lib/domain/resources/resources';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import {
  createWorkItemStatus,
  listWorkItemStatuses,
} from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Work Item, and I18 four times over.
 *
 * A work item names a status, a customer, a location and a resource. Every one of those is
 * an opportunity to point across the tenant wall, and RLS stops none of them: a policy on
 * `work_items` checks the work item's own organization_id and is satisfied while the ids
 * beside it name anyone at all. The composite references are what make those rows
 * impossible to write, and the tests below insert directly to prove it.
 *
 * D6 gets its first real exercise here too. Nothing in the domain layer knows what any
 * status means; two tenants pick different words for the same stage and neither is
 * privileged.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  typeId: string;
  statusId: string;
  customerId: string;
  locationId: string;
  resourceId: string;
};

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string, statusName: string): Promise<Tenant> {
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

  // A status belongs to a type, so the type comes first. Both tenants call theirs the same
  // thing for the same reason the statuses differ: the collision is the point.
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: orgId, name: 'Callout' });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    typeId,
    statusId: await createWorkItemStatus(db, {
      organizationId: orgId,
      typeId,
      name: statusName,
    }),
    customerId: await createCustomer(db, { organizationId: orgId, name: `${label} Customer` }),
    locationId: await createLocation(db, {
      organizationId: orgId,
      label: `${label} Site`,
      address: `1 ${label} Way`,
    }),
    resourceId: await createResource(db, { resourceClass: 'other', organizationId: orgId, name: `${label} Tech` }),
  };
}

/** Insert a work item without the domain layer, the way a raw PostgREST call would. */
async function insertDirectly(tenant: Tenant, overrides: Record<string, string>) {
  return tenant.db.from('work_items').insert({
    organization_id: tenant.organizationId,
    title: `Direct ${randomUUID().slice(0, 6)}`,
    type_id: tenant.typeId,
    status_id: tenant.statusId,
    created_by: tenant.userId,
    ...overrides,
  });
}

describe('work items', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    // Deliberately different words for the same stage. Neither is the platform's.
    alice = await newTenant('wi-alice', 'Scheduled');
    bob = await newTenant('wi-bob', 'Ingepland');
  });

  it('lets two tenants name the same status (I2, D6)', async () => {
    // Both boards now gain a column called Done. If work_item_statuses_org_name_unique had
    // lost its leading organization_id, the second of these would fail.
    const mine = await createWorkItemStatus(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
      name: 'Done',
    });
    const theirs = await createWorkItemStatus(bob.db, {
      organizationId: bob.organizationId,
      typeId: bob.typeId,
      name: 'Done',
    });

    expect(mine).not.toBe(theirs);
  });

  it('refuses two statuses with the same name on one type (I2)', async () => {
    await expect(
      createWorkItemStatus(alice.db, {
        organizationId: alice.organizationId,
        typeId: alice.typeId,
        name: 'done',
      }),
    ).rejects.toMatchObject({ code: 'statuses.name_taken' });
  });

  it('puts a new status at the end of that type\'s board', async () => {
    const statuses = await listWorkItemStatuses(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    expect(statuses.map((s) => s.name)).toEqual(['Scheduled', 'Done']);
    expect(statuses[1].position).toBeGreaterThan(statuses[0].position);
  });

  it('records a work item against its own tenant\'s rows', async () => {
    const id = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Replace pump',
      statusId: alice.statusId,
      customerId: alice.customerId,
      locationId: alice.locationId,
      resourceId: alice.resourceId,
    });
    expect(id).toBeTypeOf('string');

    const [item] = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    expect(item.title).toBe('Replace pump');
    expect(item.status.label).toBe('Scheduled');
    expect(item.customer?.label).toBe('wi-alice Customer');
    expect(item.location?.label).toBe('wi-alice Site');
    expect(item.resource?.label).toBe('wi-alice Tech');
  });

  it('allows a work item with no customer, location or resource', async () => {
    // Internal work, a workshop job, and a job nobody has picked up yet are all ordinary.
    const id = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Tidy the yard',
      statusId: alice.statusId,
    });
    expect(id).toBeTypeOf('string');

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    const unassigned = items.find((i) => i.title === 'Tidy the yard');
    expect(unassigned?.customer).toBeNull();
    expect(unassigned?.location).toBeNull();
    expect(unassigned?.resource).toBeNull();
  });

  it('cannot borrow another tenant\'s customer (I18)', async () => {
    const { error } = await insertDirectly(alice, { customer_id: bob.customerId });
    expect(error?.code).toBe('23503');
  });

  it('cannot borrow another tenant\'s location (I18)', async () => {
    const { error } = await insertDirectly(alice, { location_id: bob.locationId });
    expect(error?.code).toBe('23503');
  });

  it('cannot borrow another tenant\'s resource (I18)', async () => {
    const { error } = await insertDirectly(alice, { resource_id: bob.resourceId });
    expect(error?.code).toBe('23503');
  });

  it('cannot borrow another tenant\'s status (I18)', async () => {
    const { error } = await insertDirectly(alice, { status_id: bob.statusId });
    expect(error?.code).toBe('23503');
  });

  it('reports a cross-tenant reference as absent rather than forbidden', async () => {
    await expect(
      createWorkItem(alice.db, {
        organizationId: alice.organizationId,
        title: 'Borrowed',
        statusId: alice.statusId,
        customerId: bob.customerId,
      }),
    ).rejects.toMatchObject({ code: 'work_items.reference_not_found' });
  });

  it('shows each tenant only its own work', async () => {
    const theirs = await listWorkItems(bob.db, { organizationId: bob.organizationId });
    expect(theirs).toEqual([]);

    const acrossTheWall = await listWorkItems(alice.db, {
      organizationId: bob.organizationId,
    });
    expect(acrossTheWall).toEqual([]);
  });

  it('carries custom fields, scoped to work items', async () => {
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'work_item',
      key: 'priority',
      label: 'Priority',
      kind: 'number',
      required: false,
    });

    await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Urgent callout',
      statusId: alice.statusId,
      custom: { priority: '1' },
    });

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    expect(items.find((i) => i.title === 'Urgent callout')?.custom.priority).toBe(1);

    // `gate_code` belongs to locations, not work items.
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'location',
      key: 'gate_code',
      label: 'Gate code',
      kind: 'text',
      required: false,
    });
    await expect(
      createWorkItem(alice.db, {
        organizationId: alice.organizationId,
        title: 'Wrong entity',
        statusId: alice.statusId,
        custom: { gate_code: '4821' },
      }),
    ).rejects.toMatchObject({ code: 'fields.unknown' });
  });

  it('keeps a work item when its customer is deleted, and nulls only that column', async () => {
    // `on delete set null (customer_id)` names the column deliberately: a bare
    // `on delete set null` would try to null organization_id too, which is NOT NULL, and the
    // delete would fail at runtime instead of here.
    const doomed = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Doomed Ltd',
    });
    await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Survives its customer',
      statusId: alice.statusId,
      customerId: doomed,
    });

    // Deleted over a direct connection rather than through PostgREST: `customers` grants
    // only select and insert, deliberately, so no API caller can delete one. What is under
    // test is the database's referential behaviour, not a route.
    const pg = new Client({
      connectionString:
        process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
    await pg.connect();
    try {
      await pg.query('delete from public.customers where id = $1', [doomed]);
    } finally {
      await pg.end();
    }

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    const survivor = items.find((i) => i.title === 'Survives its customer');
    expect(survivor).toBeDefined();
    expect(survivor!.customer).toBeNull();
    expect(survivor!.status.label).toBe('Scheduled');
  });

  it('refuses work items to a member without the capability (I12)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Work',
      capabilities: ['role.manage', 'customer.create'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      createWorkItem(bob.db, {
        organizationId: bob.organizationId,
        title: 'Should not exist',
        statusId: bob.statusId,
      }),
    ).rejects.toMatchObject({ code: 'work_items.forbidden' });
  });

  it('records work items and statuses on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .in('action', ['work_item.created', 'work_item_status.created']);

    expect(error).toBeNull();
    expect(data!.some((e) => e.action === 'work_item.created')).toBe(true);
    expect(data!.some((e) => e.action === 'work_item_status.created')).toBe(true);
    for (const event of data!) {
      expect(event.actor_id).toBe(alice.userId);
    }
  });
});
