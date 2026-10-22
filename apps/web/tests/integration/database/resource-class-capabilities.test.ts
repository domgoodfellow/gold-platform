import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignResourceCapability,
  createResourceCapability,
  listResourceCapabilities,
  removeResourceCapability,
  renameResourceCapability,
  setResourceCapabilityArchived,
} from '@/lib/domain/resources/resource-capabilities';
import { RESOURCE_CLASSES, type ResourceClass } from '@/lib/domain/resources/resource-class';
import {
  createResource,
  getResource,
  listResources,
  setResourceClass,
  setResourceMembership,
} from '@/lib/domain/resources/resources';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * What a resource is, and what it can do.
 *
 * The class is platform vocabulary and is stated, never guessed; capabilities are the business's
 * own words, many-to-many, tenant-owned and identified by id. Every refusal below is proved where
 * it is enforced — often by writing around the domain layer — because the point of putting this
 * in the database is that no caller can skip it. Nothing here touches scheduling: eligibility is
 * not availability, and no work type requires anything yet.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };
type Tenant = Person & { organizationId: string };

let pg: Client;
let alice: Tenant;
let bob: Tenant;
let sam: Person;
let samMembershipId: string;

async function signUp(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: data.user.id, email };
}

async function newTenant(label: string): Promise<Tenant> {
  const person = await signUp(label);
  const organizationId = await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });
  return { ...person, organizationId: organizationId as string };
}

const names = (resources: { name: string }[]) => resources.map((resource) => resource.name).sort();

describe('a resource has a class and capabilities', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
    alice = await newTenant('rc-alice');
    bob = await newTenant('rc-bob');

    // A member who may add resources and nothing else — no update, no configuration.
    sam = await signUp('rc-sam');
    const limited = await createRole(alice.db, {
      organizationId: alice.organizationId,
      name: 'Adder',
      capabilities: ['resource.create'],
    });
    await addMember(alice.db, { organizationId: alice.organizationId, email: sam.email, displayName: 'Sam', roleId: limited });
    const { data } = await alice.db
      .from('memberships')
      .select('id')
      .eq('organization_id', alice.organizationId)
      .eq('user_id', sam.userId)
      .single();
    samMembershipId = data!.id;
  });

  afterAll(async () => {
    await pg.end();
  });

  describe('class', () => {
    it('has no default and is checked, so a resource must say what it is', async () => {
      const { rows } = await pg.query(
        `select column_default, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'resources' and column_name = 'resource_class'`,
      );
      expect(rows).toEqual([{ column_default: null, is_nullable: 'NO' }]);

      // Written directly: no class, and a class that is not one of the five.
      const unsaid = await alice.db
        .from('resources')
        .insert({ organization_id: alice.organizationId, name: 'Unsaid', created_by: alice.userId } as never);
      expect(unsaid.error).not.toBeNull();
      const invalid = await alice.db.rpc('create_resource', {
        p_organization_id: alice.organizationId,
        p_name: 'Bogus',
        p_resource_class: 'mechanic',
        p_custom: {},
      });
      expect(invalid.error?.code).toBe('23514');
      await expect(
        createResource(alice.db, { organizationId: alice.organizationId, name: 'Bogus', resourceClass: 'mechanic' as ResourceClass }),
      ).rejects.toMatchObject({ code: 'resources.class_required' });
    });

    it('records each of the five classes', async () => {
      for (const resourceClass of RESOURCE_CLASSES) {
        const id = await createResource(alice.db, { organizationId: alice.organizationId, name: `A ${resourceClass}`, resourceClass });
        expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: id }))?.resourceClass).toBe(resourceClass);
      }
    });

    it('lets a person exist with no login, and a member only ever be a person', async () => {
      const contractor = await createResource(alice.db, { organizationId: alice.organizationId, name: 'Contractor', resourceClass: 'person' });
      expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: contractor }))?.member).toBeNull();

      // A linked non-person: refused by the domain, and by the table when written around it.
      await expect(
        createResource(alice.db, { organizationId: alice.organizationId, name: 'Van of Sam', resourceClass: 'vehicle', membershipId: samMembershipId }),
      ).rejects.toMatchObject({ code: 'resources.member_requires_person' });
      const raw = await alice.db.rpc('create_resource', {
        p_organization_id: alice.organizationId,
        p_name: 'Van of Sam',
        p_resource_class: 'vehicle',
        p_custom: {},
        p_membership_id: samMembershipId,
      });
      expect(raw.error?.code).toBe('23514');
      expect(raw.error?.message).toContain('resources_member_is_person');
    });

    it('changes class when that is valid, and refuses to turn a member into a vehicle', async () => {
      const lift = await createResource(alice.db, { organizationId: alice.organizationId, name: 'Lift', resourceClass: 'other' });
      await setResourceClass(alice.db, { resourceId: lift, resourceClass: 'equipment' });
      expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: lift }))?.resourceClass).toBe('equipment');

      const sampleMember = await createResource(alice.db, {
        organizationId: alice.organizationId,
        name: 'Sam (resource)',
        resourceClass: 'person',
        membershipId: samMembershipId,
      });
      await expect(setResourceClass(alice.db, { resourceId: sampleMember, resourceClass: 'vehicle' })).rejects.toMatchObject({
        code: 'resources.member_requires_person',
      });
      // Nothing was unlinked on the way.
      expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: sampleMember }))?.member?.membershipId).toBe(samMembershipId);

      // After somebody clears the link on purpose, it may change — and a non-person cannot take one.
      await setResourceMembership(alice.db, { resourceId: sampleMember, membershipId: null });
      await setResourceClass(alice.db, { resourceId: sampleMember, resourceClass: 'vehicle' });
      await expect(setResourceMembership(alice.db, { resourceId: sampleMember, membershipId: samMembershipId })).rejects.toMatchObject({
        code: 'resources.member_requires_person',
      });
    });

    it('holds for every existing row: no resource represents a member and is anything but a person', async () => {
      const { rows } = await pg.query(
        `select count(*)::int as bad from public.resources where membership_id is not null and resource_class <> 'person'`,
      );
      expect(rows[0].bad).toBe(0);
    });

    it('is changed only by somebody who may update the resource', async () => {
      const id = await createResource(sam.db, { organizationId: alice.organizationId, name: 'By Sam', resourceClass: 'other' });
      await expect(setResourceClass(sam.db, { resourceId: id, resourceClass: 'vehicle' })).rejects.toMatchObject({ code: 'resources.update_forbidden' });
    });
  });

  describe('capabilities', () => {
    it('are tenant vocabulary, unique by name whatever the case, and renamed without losing identity or assignments', async () => {
      const tires = await createResourceCapability(alice.db, { organizationId: alice.organizationId, name: 'Tire Service' });
      await expect(
        createResourceCapability(alice.db, { organizationId: alice.organizationId, name: 'tire service' }),
      ).rejects.toMatchObject({ code: 'resource_capabilities.name_taken' });
      // Another business may use the very same word.
      await expect(createResourceCapability(bob.db, { organizationId: bob.organizationId, name: 'Tire Service' })).resolves.toEqual(expect.any(String));

      const dominic = await createResource(alice.db, { organizationId: alice.organizationId, name: 'Dominic', resourceClass: 'person', capabilityIds: [tires] });
      await renameResourceCapability(alice.db, { id: tires, name: 'Tire & Wheel Service' });

      const after = await getResource(alice.db, { organizationId: alice.organizationId, resourceId: dominic });
      expect(after?.capabilities).toEqual([{ id: tires, name: 'Tire & Wheel Service', archived: false }]);
    });

    it('assign and remove, once each, and a pair cannot be given twice', async () => {
      const oil = await createResourceCapability(alice.db, { organizationId: alice.organizationId, name: 'Oil change' });
      const van = await createResource(alice.db, { organizationId: alice.organizationId, name: 'Service Van 1', resourceClass: 'vehicle' });

      await assignResourceCapability(alice.db, { resourceId: van, capabilityId: oil });
      await expect(assignResourceCapability(alice.db, { resourceId: van, capabilityId: oil })).rejects.toMatchObject({
        code: 'resource_capabilities.already_assigned',
      });
      expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: van }))?.capabilities.map((c) => c.name)).toEqual(['Oil change']);

      await removeResourceCapability(alice.db, { resourceId: van, capabilityId: oil });
      expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: van }))?.capabilities).toEqual([]);
      await expect(removeResourceCapability(alice.db, { resourceId: van, capabilityId: oil })).rejects.toMatchObject({
        code: 'resource_capabilities.assign_forbidden',
      });
    });

    it('cannot cross tenants, by the domain, the raw RPC or the table', async () => {
      const theirs = await createResourceCapability(bob.db, { organizationId: bob.organizationId, name: 'Theirs only' });
      const mine = await createResource(alice.db, { organizationId: alice.organizationId, name: 'Mine', resourceClass: 'other' });

      await expect(assignResourceCapability(alice.db, { resourceId: mine, capabilityId: theirs })).rejects.toMatchObject({
        code: 'resource_capabilities.not_found',
      });
      // Written directly, with the tenant stated: the composite reference refuses it.
      await expect(
        pg.query(
          'insert into public.resource_capability_assignments (organization_id, resource_id, capability_id, created_by) values ($1, $2, $3, $4)',
          [alice.organizationId, mine, theirs, alice.userId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      // And a capability's own tenant cannot be read from outside it.
      const { data } = await alice.db.from('resource_capabilities').select('id').eq('id', theirs);
      expect(data).toEqual([]);
    });

    it('can be archived: kept where held, refused to anything new, and restored', async () => {
      const retired = await createResourceCapability(alice.db, { organizationId: alice.organizationId, name: 'Retired skill' });
      const holder = await createResource(alice.db, { organizationId: alice.organizationId, name: 'Holder', resourceClass: 'person', capabilityIds: [retired] });
      const other = await createResource(alice.db, { organizationId: alice.organizationId, name: 'Newcomer', resourceClass: 'person' });

      await setResourceCapabilityArchived(alice.db, { id: retired, archived: true });
      expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: holder }))?.capabilities).toEqual([
        { id: retired, name: 'Retired skill', archived: true },
      ]);
      await expect(assignResourceCapability(alice.db, { resourceId: other, capabilityId: retired })).rejects.toMatchObject({
        code: 'resource_capabilities.archived',
      });
      expect((await listResourceCapabilities(alice.db, { organizationId: alice.organizationId })).map((c) => c.id)).not.toContain(retired);
      expect((await listResourceCapabilities(alice.db, { organizationId: alice.organizationId, includeArchived: true })).map((c) => c.id)).toContain(retired);

      await setResourceCapabilityArchived(alice.db, { id: retired, archived: false });
      await expect(assignResourceCapability(alice.db, { resourceId: other, capabilityId: retired })).resolves.toBeUndefined();
    });

    it('has no delete: the vocabulary is renamed or archived, never erased', async () => {
      const kept = await createResourceCapability(alice.db, { organizationId: alice.organizationId, name: 'Keep me' });
      const { error } = await alice.db.from('resource_capabilities').delete().eq('id', kept);
      expect(error).not.toBeNull();
      await expect(pg.query('select 1 from public.resource_capabilities where id = $1', [kept])).resolves.toMatchObject({ rowCount: 1 });
    });

    it('is configured by whoever may configure, and given by whoever may change a resource', async () => {
      await expect(createResourceCapability(sam.db, { organizationId: alice.organizationId, name: 'Sams word' })).rejects.toMatchObject({
        code: 'resource_capabilities.forbidden',
      });

      // Sam may add a resource with a capability the business already has…
      const vocab = await createResourceCapability(alice.db, { organizationId: alice.organizationId, name: 'For Sam' });
      const made = await createResource(sam.db, { organizationId: alice.organizationId, name: 'Sam made', resourceClass: 'person', capabilityIds: [vocab] });
      expect((await getResource(alice.db, { organizationId: alice.organizationId, resourceId: made }))?.capabilities).toHaveLength(1);
      // …but may not take one away, which is correcting a resource.
      await expect(removeResourceCapability(sam.db, { resourceId: made, capabilityId: vocab })).rejects.toMatchObject({
        code: 'resource_capabilities.assign_forbidden',
      });
    });

    it('leaves a trail: every mutation is an event by the person who made it', async () => {
      const { rows } = await pg.query(
        `select distinct action from public.events
          where organization_id = $1 and (action like 'resource_capability.%' or action like 'resource.capability_%' or action = 'resource.class_changed')`,
        [alice.organizationId],
      );
      expect(rows.map((row) => row.action).sort()).toEqual(
        expect.arrayContaining([
          'resource.capability_assigned',
          'resource.capability_removed',
          'resource.class_changed',
          'resource_capability.archived',
          'resource_capability.created',
          'resource_capability.renamed',
          'resource_capability.restored',
        ]),
      );
    });
  });

  describe('eligibility queries (not availability)', () => {
    it('list by class, by capability, and by both — every resource showing everything it can do', async () => {
      const t = await newTenant('rc-query');
      const org = t.organizationId;
      const tires = await createResourceCapability(t.db, { organizationId: org, name: 'Tire service' });
      const mobile = await createResourceCapability(t.db, { organizationId: org, name: 'Mobile service' });

      await createResource(t.db, { organizationId: org, name: 'Dominic', resourceClass: 'person', capabilityIds: [tires, mobile] });
      await createResource(t.db, { organizationId: org, name: 'Alex', resourceClass: 'person', capabilityIds: [mobile] });
      await createResource(t.db, { organizationId: org, name: 'Van 1', resourceClass: 'vehicle', capabilityIds: [mobile] });
      await createResource(t.db, { organizationId: org, name: 'Bay 1', resourceClass: 'facility' });
      await createResource(t.db, { organizationId: org, name: 'Tire Machine', resourceClass: 'equipment', capabilityIds: [tires] });

      expect(names(await listResources(t.db, { organizationId: org, resourceClass: 'person' }))).toEqual(['Alex', 'Dominic']);
      expect(names(await listResources(t.db, { organizationId: org, resourceClass: 'vehicle' }))).toEqual(['Van 1']);
      expect(names(await listResources(t.db, { organizationId: org, capabilityId: tires }))).toEqual(['Dominic', 'Tire Machine']);
      expect(names(await listResources(t.db, { organizationId: org, resourceClass: 'person', capabilityId: tires }))).toEqual(['Dominic']);
      expect(names(await listResources(t.db, { organizationId: org, resourceClass: 'facility', capabilityId: tires }))).toEqual([]);

      // A filtered list still shows everything the resource can do, not only what was asked for.
      const [dominic] = await listResources(t.db, { organizationId: org, resourceClass: 'person', capabilityId: tires });
      expect(dominic.capabilities.map((capability) => capability.name)).toEqual(['Mobile service', 'Tire service']);
    });
  });

  describe('the migration', () => {
    it('classifies a member-linked resource as a person and every other existing one as other, and loses nothing', async () => {
      // The migration's own backfill statement, read from the file and pointed at a table shaped
      // like `resources` before it ran — so what is proved is the statement that shipped.
      const file = readFileSync(
        join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', '20261022000032_a_resource_has_a_class_and_capabilities.sql'),
        'utf8',
      );
      const backfill = /update public\.resources\s+set resource_class = case[^;]+;/i.exec(file)?.[0];
      expect(backfill).toBeDefined();

      await pg.query('begin');
      try {
        await pg.query(
          `create temp table resources_before (id uuid primary key, organization_id uuid not null, name text not null,
             custom jsonb not null, membership_id uuid, resource_class text)`,
        );
        const [linked, van, room] = [randomUUID(), randomUUID(), randomUUID()];
        await pg.query(
          `insert into resources_before (id, organization_id, name, custom, membership_id) values
             ($1, $4, 'Sam', '{"badge":"7"}', $5), ($2, $4, 'Van 1', '{"plate":"AB"}', null), ($3, $4, 'Treatment room', '{}', null)`,
          [linked, van, room, alice.organizationId, samMembershipId],
        );
        await pg.query(backfill!.replace('public.resources', 'resources_before'));
        const { rows } = await pg.query('select * from resources_before order by name');
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

        expect(byName['Sam'].resource_class).toBe('person');
        // Names are not evidence: a van and a room are not guessed from what they are called.
        expect(byName['Van 1'].resource_class).toBe('other');
        expect(byName['Treatment room'].resource_class).toBe('other');
        // Nothing else moved.
        expect(byName['Sam']).toMatchObject({ id: linked, membership_id: samMembershipId, custom: { badge: '7' }, organization_id: alice.organizationId });
        expect(byName['Van 1'].custom).toEqual({ plate: 'AB' });
      } finally {
        await pg.query('rollback');
      }
    });
  });
});
