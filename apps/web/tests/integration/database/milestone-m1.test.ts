import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAsset, listAssets } from '@/lib/domain/assets/assets';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import { listDocuments, uploadDocument } from '@/lib/domain/documents/documents';
import {
  createFieldDefinition,
  listFieldDefinitions,
} from '@/lib/domain/fields/field-definitions';
import {
  createLocation,
  linkCustomerLocation,
  listLocations,
} from '@/lib/domain/locations/locations';
import { createResource, listResources } from '@/lib/domain/resources/resources';
import { addMember, listMembers } from '@/lib/domain/tenancy/members';
import {
  getOrganization } from '@/lib/domain/tenancy/organizations';
import { createRole, listRoles } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus, listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * THE M1 MILESTONE TEST.
 *
 * roadmap.md does not describe M1 as a list of tables. It describes one demonstration:
 *
 *   > two organizations exist in one database, each with its own users, customers,
 *   > locations, and work items, and no query, index, or constraint belonging to one can
 *   > observe or block the other — demonstrated by a test that creates colliding rows in
 *   > both tenants and expects success.
 *
 * "That test is the milestone. It is also the thing every prior attempt deferred."
 *
 * Every other test file proves one entity at a time. This one proves the claim as a whole,
 * and it does it by building two tenants from *byte-identical input*: the same organization
 * name, the same customer email, the same site label, the same technician name, the same
 * machine, the same board column, the same job title, the same field key, the same file
 * name, the same kind of work. Not similar — identical. Every one of those is a natural key
 * that a single-tenant schema would have made unique, and every one of them must collide
 * harmlessly.
 *
 * The failure it exists to catch is named in constraints.md, from a real prior repository:
 *
 *   > Its `customers_email_unique` is global too, so two tenants could never share a
 *   > customer email address.
 *
 * Both halves of "observe or block" are asserted. *Block* is the collisions succeeding.
 * *Observe* is each tenant seeing exactly its own rows — and the counts are asserted rather
 * than emptiness, because a test where both tenants see nothing passes for the wrong reason.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Deliberately identical across both tenants. Every one is a would-be unique key. */
const RUN = randomUUID().slice(0, 8);
const SHARED = {
  organizationName: `Identical Operations Ltd ${RUN}`,
  customerEmail: `shared-${RUN}@example.test`,
  customerName: 'Northern Manufacturing',
  locationLabel: 'North Depot',
  resourceName: 'Sam Okafor',
  assetName: 'Compressor A',
  typeName: 'Callout',
  statusName: 'Scheduled',
  workItemTitle: 'Replace the pump',
  roleName: 'Technician',
  fieldKey: 'vat_number',
  fileName: 'contract.txt',
} as const;

type Person = { db: SupabaseClient; userId: string; email: string };

type Tenant = {
  founder: Person;
  staff: Person;
  organizationId: string;
  customerId: string;
  locationId: string;
  resourceId: string;
  assetId: string;
  typeId: string;
  statusId: string;
  workItemId: string;
  documentId: string;
};

let a: Tenant;
let b: Tenant;

async function signUp(label: string): Promise<Person> {
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

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { db, userId: created.user.id, email };
}

/**
 * Build one whole business, from input identical to the other's.
 *
 * The only thing that differs between the two calls is which humans are in it. Everything a
 * database might have made globally unique is the same string in both.
 */
async function buildTenant(label: string): Promise<Tenant> {
  const founder = await signUp(`${label}-founder`);
  const staff = await signUp(`${label}-staff`);

  const organizationId = await foundBusiness({ ownerEmail: founder.email,
    name: SHARED.organizationName,
    displayName: 'The Founder',
    currency: 'EUR',
  });

  // A second human, so "each with its own users" is literally true.
  const staffRoleId = await createRole(founder.db, {
    organizationId,
    name: SHARED.roleName,
    capabilities: ['customer.create'],
  });
  await addMember(founder.db, {
    organizationId,
    email: staff.email,
    displayName: 'Sam',
    roleId: staffRoleId,
  });

  // The registry, before anything that carries custom fields.
  for (const entityType of ['customer', 'location', 'resource', 'asset', 'work_item'] as const) {
    await createFieldDefinition(founder.db, {
      organizationId,
      entityType,
      key: SHARED.fieldKey,
      label: 'VAT number',
      kind: 'text',
      required: false,
    });
  }

  const customerId = await createCustomer(founder.db, {
    organizationId,
    name: SHARED.customerName,
    email: SHARED.customerEmail,
    custom: { [SHARED.fieldKey]: `VAT-${label}` },
  });

  const locationId = await createLocation(founder.db, {
    organizationId,
    label: SHARED.locationLabel,
    address: '1 Identical Way',
    custom: { [SHARED.fieldKey]: `VAT-${label}` },
  });

  await linkCustomerLocation(founder.db, { organizationId, customerId, locationId });

  const resourceId = await createResource(founder.db, {
    organizationId,
    name: SHARED.resourceName,
    custom: { [SHARED.fieldKey]: `VAT-${label}` },
  });

  const assetId = await createAsset(founder.db, {
    organizationId,
    name: SHARED.assetName,
    customerId,
    locationId,
    custom: { [SHARED.fieldKey]: `VAT-${label}` },
  });

  const typeId = await createWorkItemType(founder.db, { schedulable: true,
    organizationId,
    name: SHARED.typeName,
  });

  const statusId = await createWorkItemStatus(founder.db, {
    organizationId,
    typeId,
    name: SHARED.statusName,
  });

  const workItemId = await createWorkItem(founder.db, {
    organizationId,
    title: SHARED.workItemTitle,
    statusId,
    customerId,
    locationId,
    resourceId,
    assetId,
    custom: { [SHARED.fieldKey]: `VAT-${label}` },
  });

  const documentId = await uploadDocument(founder.db, {
    organizationId,
    attachedTo: { entity: 'customer', id: customerId },
    file: new File([`contract for ${label}`], SHARED.fileName, { type: 'text/plain' }),
  });

  return {
    founder,
    staff,
    organizationId,
    customerId,
    locationId,
    resourceId,
    assetId,
    typeId,
    statusId,
    workItemId,
    documentId,
  };
}

describe('M1 — the kernel', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    // If either of these throws, a unique index somewhere has lost its leading tenant column
    // and the milestone is not met. The second call is the whole point of the first.
    a = await buildTenant('alpha');
    b = await buildTenant('beta');
  });

  it('builds two whole businesses from identical input, in one database', () => {
    // Nothing collided. Every id below is a row a single-tenant schema would have rejected
    // the second time.
    expect(a.organizationId).not.toBe(b.organizationId);
    expect(a.customerId).not.toBe(b.customerId);
    expect(a.locationId).not.toBe(b.locationId);
    expect(a.resourceId).not.toBe(b.resourceId);
    expect(a.assetId).not.toBe(b.assetId);
    expect(a.statusId).not.toBe(b.statusId);
    expect(a.workItemId).not.toBe(b.workItemId);
    expect(a.documentId).not.toBe(b.documentId);
  });

  it('lets both tenants hold the same customer email address', async () => {
    // The regression test for the failure constraints.md names by name.
    const mine = await listCustomers(a.founder.db, { organizationId: a.organizationId });
    const theirs = await listCustomers(b.founder.db, { organizationId: b.organizationId });

    expect(mine.map((c) => c.email)).toEqual([SHARED.customerEmail]);
    expect(theirs.map((c) => c.email)).toEqual([SHARED.customerEmail]);
  });

  it('shows each tenant its own rows and only its own', async () => {
    // Counts, not emptiness. A version of this test where both tenants saw nothing would
    // pass for entirely the wrong reason.
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const organizationId = self.organizationId;
      const db = self.founder.db;

      const [
        customers,
        locations,
        resources,
        assets,
        types,
        statuses,
        workItems,
        members,
        roles,
      ] = await Promise.all([
        listCustomers(db, { organizationId }),
        listLocations(db, { organizationId }),
        listResources(db, { organizationId }),
        listAssets(db, { organizationId }),
        listWorkItemTypes(db, { organizationId }),
        listWorkItemStatuses(db, { organizationId, typeId: self.typeId }),
        listWorkItems(db, { organizationId }),
        listMembers(db, { organizationId }),
        listRoles(db, { organizationId }),
      ]);

      expect(customers.map((r) => r.id)).toEqual([self.customerId]);
      expect(locations.map((r) => r.id)).toEqual([self.locationId]);
      expect(resources.map((r) => r.id)).toEqual([self.resourceId]);
      expect(assets.map((r) => r.id)).toEqual([self.assetId]);
      expect(types.map((r) => r.id)).toEqual([self.typeId]);
      expect(statuses.map((r) => r.id)).toEqual([self.statusId]);
      expect(workItems.map((r) => r.id)).toEqual([self.workItemId]);
      expect(members).toHaveLength(2);
      expect(roles.map((r) => r.name).sort()).toEqual(['Admin', SHARED.roleName].sort());

      // And nothing of the other tenant's is anywhere in there.
      const everything = [
        ...customers.map((r) => r.id),
        ...locations.map((r) => r.id),
        ...resources.map((r) => r.id),
        ...assets.map((r) => r.id),
        ...types.map((r) => r.id),
        ...statuses.map((r) => r.id),
        ...workItems.map((r) => r.id),
      ];
      for (const foreign of [
        other.customerId,
        other.locationId,
        other.resourceId,
        other.assetId,
        other.typeId,
        other.statusId,
        other.workItemId,
      ]) {
        expect(everything).not.toContain(foreign);
      }
    }
  });

  it('cannot reach the other tenant even holding its ids', async () => {
    // Knowing an id is not access. Asking for the other organization by its real id returns
    // nothing rather than raising, because from here it genuinely does not exist.
    expect(await getOrganization(a.founder.db, b.organizationId)).toBeNull();
    expect(await getOrganization(b.founder.db, a.organizationId)).toBeNull();

    expect(await listCustomers(a.founder.db, { organizationId: b.organizationId })).toEqual([]);
    expect(await listWorkItems(a.founder.db, { organizationId: b.organizationId })).toEqual([]);
    expect(await listMembers(a.founder.db, { organizationId: b.organizationId })).toEqual([]);
  });

  it('gives each tenant its own users, each seeing their own role', async () => {
    // "Each with its own users" is plural on purpose, and until the membership slice it was
    // not merely untested but impossible.
    for (const tenant of [a, b]) {
      const asFounder = await getOrganization(tenant.founder.db, tenant.organizationId);
      const asStaff = await getOrganization(tenant.staff.db, tenant.organizationId);

      expect(asFounder?.role).toBe('Admin');
      expect(asStaff?.role).toBe(SHARED.roleName);
      expect(asStaff?.capabilities).toEqual(['customer.create']);
    }

    // And one tenant's staff cannot see the other tenant at all.
    expect(await getOrganization(a.staff.db, b.organizationId)).toBeNull();
    expect(await getOrganization(b.staff.db, a.organizationId)).toBeNull();
  });

  it('lets both tenants define the same field key and keep different values', async () => {
    for (const [tenant, label] of [
      [a, 'alpha'],
      [b, 'beta'],
    ] as const) {
      const definitions = await listFieldDefinitions(tenant.founder.db, {
        organizationId: tenant.organizationId,
        entityType: 'customer',
      });
      expect(definitions.map((d) => d.key)).toEqual([SHARED.fieldKey]);

      const [customer] = await listCustomers(tenant.founder.db, {
        organizationId: tenant.organizationId,
      });
      expect(customer.custom[SHARED.fieldKey]).toBe(`VAT-${label}`);
    }
  });

  it('carries the same file name in both tenants, in one bucket', async () => {
    for (const tenant of [a, b]) {
      const documents = await listDocuments(tenant.founder.db, {
        organizationId: tenant.organizationId,
        attachedTo: { entity: 'customer', id: tenant.customerId },
      });
      expect(documents.map((d) => d.fileName)).toEqual([SHARED.fileName]);
    }

    // Same name, different bytes, neither reachable from the other side.
    const { data: mine } = await a.founder.db
      .from('documents')
      .select('storage_path')
      .eq('id', a.documentId)
      .single();
    const { error } = await b.founder.db.storage.from('documents').download(mine!.storage_path);
    expect(error).not.toBeNull();
  });

  it('refuses a row that would join the two tenants (I18)', async () => {
    // The composite references, sampled. Each of these is proved exhaustively in its own
    // test file; here it matters that the whole kernel holds the line at once.
    const attempts = await Promise.all([
      a.founder.db.from('work_items').insert({
        organization_id: a.organizationId,
        title: 'Borrowed customer',
        type_id: a.typeId,
        status_id: a.statusId,
        customer_id: b.customerId,
        created_by: a.founder.userId,
      }),
      a.founder.db.from('customer_locations').insert({
        organization_id: a.organizationId,
        customer_id: a.customerId,
        location_id: b.locationId,
        created_by: a.founder.userId,
      }),
      a.founder.db.from('assets').insert({
        organization_id: a.organizationId,
        name: 'Borrowed owner',
        customer_id: b.customerId,
        created_by: a.founder.userId,
      }),
    ]);

    for (const attempt of attempts) {
      expect(attempt.error?.code).toBe('23503');
    }
  });

  it('keeps each tenant\'s timeline to itself (I11)', async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const { data, error } = await self.founder.db
        .from('events')
        .select('organization_id, actor_id, entity_id');

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);

      // Every event visible from here belongs to this tenant, and none names the other's rows.
      for (const event of data!) {
        expect(event.organization_id).toBe(self.organizationId);
      }
      expect(data!.map((e) => e.entity_id)).not.toContain(other.customerId);
    }
  });
});
