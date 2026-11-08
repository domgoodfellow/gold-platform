import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  beginBooking,
  bookSlot,
  bookableSlots,
  listBookableTypes,
} from '@/lib/domain/booking/booking';
import {
  createResourceCapability,
  removeResourceCapability,
  setResourceCapabilityArchived,
} from '@/lib/domain/resources/resource-capabilities';
import { createResource } from '@/lib/domain/resources/resources';
import { computeSetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import {
  createResourceRequirement,
  deleteResourceRequirement,
  evaluateWorkItems,
  listEligibleResources,
  listResourceRequirements,
  updateResourceRequirement,
} from '@/lib/domain/work-items/requirements';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  createWorkItemType,
  setTypeBookable,
  setWorkItemTypeSchedulable,
} from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { scheduleWorkItem, setWorkItemResources } from '@/lib/domain/scheduling/schedule';
import { foundBusiness } from '@/tests/support/founding';

/**
 * What a kind of work needs.
 *
 * The database holds the structure and the few places requirements must agree with something else —
 * tenant, class, quantity, "only scheduled work needs resources", "scheduling cannot go off under
 * needs", "a needed capability is not archived", and "public booking commits one resource". It does
 * **not** require that a job's assignments satisfy its type: partial and unassigned work stays valid
 * state, and several of these cases prove exactly that.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };
type Shop = Person & {
  organizationId: string;
  tire: string;
  oil: string;
  mobile: string;
  alex: string;
  jo: string;
  van1: string;
  van2: string;
};

let pg: Client;
let shop: Shop;
let rival: Shop;

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

async function newShop(label: string): Promise<Shop> {
  const person = await signUp(label);
  const organizationId = (await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  })) as string;

  const word = (name: string) => createResourceCapability(person.db, { organizationId, name });
  const [tire, oil, mobile] = [await word('Tire service'), await word('Oil change'), await word('Mobile service')];
  const make = (name: string, resourceClass: 'person' | 'vehicle', capabilityIds: string[] = []) =>
    createResource(person.db, { organizationId, name, resourceClass, capabilityIds });

  return {
    ...person,
    organizationId,
    tire,
    oil,
    mobile,
    alex: await make('Alex', 'person', [tire, oil]),
    jo: await make('Jo', 'person', [oil]),
    van1: await make('Service Van 1', 'vehicle', [mobile]),
    van2: await make('Service Van 2', 'vehicle'),
  };
}

async function type(t: Shop, name: string, schedulable = true) {
  const typeId = await createWorkItemType(t.db, { organizationId: t.organizationId, name, schedulable });
  const statusId = await createWorkItemStatus(t.db, { organizationId: t.organizationId, typeId, name: 'Booked' });
  return { typeId, statusId };
}

describe('a work type says what resources it needs', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
    shop = await newShop('wtr-shop');
    rival = await newShop('wtr-rival');
  });

  afterAll(async () => {
    await pg.end();
  });

  describe('the structure (direct database invariants)', () => {
    it('holds a class, a quantity and capabilities, in the business’s reading order', async () => {
      const { typeId } = await type(shop, 'Mobile Tire Change');
      await createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [shop.tire] });
      await createResourceRequirement(shop.db, { typeId, resourceClass: 'vehicle', quantity: 2, capabilityIds: [shop.mobile] });

      const requirements = await listResourceRequirements(shop.db, { organizationId: shop.organizationId, typeId });
      expect(requirements.map((r) => [r.resourceClass, r.quantity, r.capabilities.map((c) => c.name)])).toEqual([
        ['person', 1, ['Tire service']],
        ['vehicle', 2, ['Mobile service']],
      ]);
      expect(requirements[0].position).toBeLessThan(requirements[1].position);
    });

    it('refuses an unknown class, and a quantity of zero, negative or absurd — through the domain and around it', async () => {
      const { typeId } = await type(shop, 'Structure');
      await expect(
        createResourceRequirement(shop.db, { typeId, resourceClass: 'mechanic' as never, quantity: 1, capabilityIds: [] }),
      ).rejects.toMatchObject({ code: 'resource_requirements.class_required' });
      for (const quantity of [0, -1, 51, 1.5]) {
        await expect(
          createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity, capabilityIds: [] }),
        ).rejects.toMatchObject({ code: 'resource_requirements.quantity_invalid' });
      }

      const rawClass = await shop.db.rpc('create_resource_requirement', { p_type_id: typeId, p_resource_class: 'mechanic', p_quantity: 1, p_capability_ids: [] });
      expect(rawClass.error?.code).toBe('23514');
      const rawQuantity = await shop.db.rpc('create_resource_requirement', { p_type_id: typeId, p_resource_class: 'person', p_quantity: 0, p_capability_ids: [] });
      expect(rawQuantity.error?.code).toBe('23514');
    });

    it('cannot cross tenants: a requirement on another business’s type, or naming its capability', async () => {
      const { typeId } = await type(shop, 'Tenancy');
      const theirs = await type(rival, 'Theirs');

      // The type is not visible to us at all.
      await expect(
        createResourceRequirement(shop.db, { typeId: theirs.typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] }),
      ).rejects.toMatchObject({ code: 'resource_requirements.forbidden' });

      // Another business's capability, by the domain and by writing the link directly.
      await expect(
        createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [rival.tire] }),
      ).rejects.toMatchObject({ code: 'resource_requirements.capability_not_found' });

      const own = await createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] });
      await expect(
        pg.query(
          'insert into public.work_item_type_resource_requirement_capabilities (organization_id, requirement_id, capability_id, created_by) values ($1, $2, $3, $4)',
          [shop.organizationId, own, rival.tire, shop.userId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      // And a requirement row cannot be written onto another tenant's type: the type is not found in this
      // tenant (the trigger says so first; the composite reference would refuse it regardless).
      const crossed = await pg
        .query(
          'insert into public.work_item_type_resource_requirements (organization_id, type_id, resource_class, quantity, created_by) values ($1, $2, $3, $4, $5)',
          [shop.organizationId, theirs.typeId, 'person', 1, shop.userId],
        )
        .then(() => null, (error: { code?: string }) => error.code);
      expect(['23503', 'GD008']).toContain(crossed);
    });

    it('refuses the same capability twice on one requirement', async () => {
      const { typeId } = await type(shop, 'Duplicates');
      const id = await createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [shop.tire] });
      const { error } = await shop.db.from('work_item_type_resource_requirement_capabilities').insert({
        organization_id: shop.organizationId,
        requirement_id: id,
        capability_id: shop.tire,
        created_by: shop.userId,
      });
      expect(error?.code).toBe('23505');
    });

    it('only schedulable work can need resources, and scheduling cannot go off while it does', async () => {
      const unscheduled = await type(shop, 'Sales opportunity', false);
      await expect(
        createResourceRequirement(shop.db, { typeId: unscheduled.typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] }),
      ).rejects.toMatchObject({ code: 'resource_requirements.not_schedulable' });
      const raw = await shop.db.rpc('create_resource_requirement', { p_type_id: unscheduled.typeId, p_resource_class: 'person', p_quantity: 1, p_capability_ids: [] });
      expect(raw.error?.code).toBe('GD008');

      const scheduled = await type(shop, 'Needs people');
      const id = await createResourceRequirement(shop.db, { typeId: scheduled.typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] });

      await expect(setWorkItemTypeSchedulable(shop.db, { id: scheduled.typeId, schedulable: false })).rejects.toMatchObject({
        code: 'work_item_types.has_requirements',
        message: expect.stringContaining('Remove the resource requirements'),
      });
      const direct = await shop.db.from('work_item_types').update({ schedulable: false }).eq('id', scheduled.typeId);
      expect(direct.error?.code).toBe('GD009');

      // Nothing was deleted on the business's behalf; remove it and it goes off.
      expect(await listResourceRequirements(shop.db, { organizationId: shop.organizationId, typeId: scheduled.typeId })).toHaveLength(1);
      await deleteResourceRequirement(shop.db, { id });
      await expect(setWorkItemTypeSchedulable(shop.db, { id: scheduled.typeId, schedulable: false })).resolves.toBeUndefined();
    });

    it('does not newly attach an archived capability, and does not archive one a type needs', async () => {
      const { typeId } = await type(shop, 'Archival');
      const word = await createResourceCapability(shop.db, { organizationId: shop.organizationId, name: 'Soon archived' });
      const retired = await createResourceCapability(shop.db, { organizationId: shop.organizationId, name: 'Retired' });
      await setResourceCapabilityArchived(shop.db, { id: retired, archived: true });

      await expect(
        createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [retired] }),
      ).rejects.toMatchObject({ code: 'resource_requirements.capability_archived' });

      const id = await createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [word] });
      await expect(setResourceCapabilityArchived(shop.db, { id: word, archived: true })).rejects.toMatchObject({
        code: 'resource_capabilities.required',
        message: expect.stringContaining('Soon archived is required by one or more kinds of work'),
      });
      const raw = await shop.db.from('resource_capabilities').update({ archived_at: new Date().toISOString() }).eq('id', word);
      expect(raw.error?.code).toBe('GD010');

      // Take it off the requirement and it can go.
      await updateResourceRequirement(shop.db, { id, resourceClass: 'person', quantity: 1, capabilityIds: [] });
      await expect(setResourceCapabilityArchived(shop.db, { id: word, archived: true })).resolves.toBeUndefined();
    });

    it('changes class, quantity and capabilities together, and removes a requirement with its links', async () => {
      const { typeId } = await type(shop, 'Editing');
      const id = await createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [shop.tire] });

      await updateResourceRequirement(shop.db, { id, resourceClass: 'vehicle', quantity: 3, capabilityIds: [shop.mobile, shop.oil] });
      const [edited] = await listResourceRequirements(shop.db, { organizationId: shop.organizationId, typeId });
      expect([edited.resourceClass, edited.quantity, edited.capabilities.map((c) => c.name)]).toEqual([
        'vehicle',
        3,
        ['Mobile service', 'Oil change'],
      ]);

      // A change that fails leaves the whole requirement as it was.
      await expect(updateResourceRequirement(shop.db, { id, resourceClass: 'person', quantity: 2, capabilityIds: [rival.tire] })).rejects.toBeDefined();
      const [after] = await listResourceRequirements(shop.db, { organizationId: shop.organizationId, typeId });
      expect([after.resourceClass, after.quantity]).toEqual(['vehicle', 3]);

      await deleteResourceRequirement(shop.db, { id });
      const links = await pg.query('select 1 from public.work_item_type_resource_requirement_capabilities where requirement_id = $1', [id]);
      expect(links.rowCount).toBe(0);
      const { rows } = await pg.query(
        `select distinct action from public.events where organization_id = $1 and action like 'work_item_type.requirement_%'`,
        [shop.organizationId],
      );
      expect(rows.map((r) => r.action).sort()).toEqual(['work_item_type.requirement_added', 'work_item_type.requirement_changed', 'work_item_type.requirement_removed']);
    });

    it('is configuration (field.manage): a member without it is refused', async () => {
      const { typeId } = await type(shop, 'Authority');
      const clerk = await signUp('wtr-clerk');
      const role = await createRole(shop.db, { organizationId: shop.organizationId, name: 'No config', capabilities: ['work_item.create'] });
      await addMember(shop.db, { organizationId: shop.organizationId, email: clerk.email, displayName: 'Clerk', roleId: role });
      await expect(
        createResourceRequirement(clerk.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] }),
      ).rejects.toMatchObject({ code: 'resource_requirements.forbidden' });
    });
  });

  describe('eligibility, and coverage of a job', () => {
    it('lists who could play a role by class and every capability — and says nothing about time', async () => {
      const eligible = async (resourceClass: 'person' | 'vehicle', capabilityIds?: string[]) =>
        (await listEligibleResources(shop.db, { organizationId: shop.organizationId, resourceClass, capabilityIds })).map((r) => r.name);

      expect(await eligible('person')).toEqual(['Alex', 'Jo']);
      expect(await eligible('person', [shop.tire])).toEqual(['Alex']);
      expect(await eligible('person', [shop.tire, shop.oil])).toEqual(['Alex']);
      expect(await eligible('person', [shop.tire, shop.mobile])).toEqual([]);
      expect(await eligible('vehicle', [shop.mobile])).toEqual(['Service Van 1']);
    });

    it('reports a partly assigned job as short without refusing it, and covers it when the rest is added', async () => {
      const { typeId, statusId } = await type(shop, 'Coverage');
      await createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [shop.tire] });
      await createResourceRequirement(shop.db, { typeId, resourceClass: 'vehicle', quantity: 1, capabilityIds: [shop.mobile] });

      const job = await createWorkItem(shop.db, { organizationId: shop.organizationId, title: 'Partly staffed', statusId, resourceIds: [shop.alex] });
      await scheduleWorkItem(shop.db, { workItemId: job, startsAt: '2027-05-03T10:00:00.000Z', endsAt: '2027-05-03T11:00:00.000Z' });

      const read = async (ids: string[]) =>
        (await evaluateWorkItems(shop.db, { organizationId: shop.organizationId, items: [{ workItemId: job, typeId, resourceIds: ids }] })).get(job)!;

      // Scheduled with only the person: valid state, and reported as missing the vehicle.
      const partial = await read([shop.alex]);
      expect(partial.satisfied).toBe(false);
      expect(partial.requirements.map((r) => [r.requirement.resourceClass, r.satisfied])).toEqual([['person', true], ['vehicle', false]]);

      // The wrong person and the wrong van do not count; the extra helper is fine.
      const wrong = await read([shop.jo, shop.van2]);
      expect(wrong.missingQuantity).toBe(2);
      const covered = await read([shop.alex, shop.van1, shop.jo]);
      expect(covered.satisfied).toBe(true);
      expect(covered.unmatchedAssignedResources.map((r) => r.name)).toEqual(['Jo']);

      // Assigning is a plain assignment with no veto from the requirements, short or over.
      await expect(setWorkItemResources(shop.db, { workItemId: job, resourceIds: [shop.alex, shop.van1] })).resolves.toBeUndefined();
      await expect(setWorkItemResources(shop.db, { workItemId: job, resourceIds: [shop.jo, shop.van2] })).resolves.toBeUndefined();
      await expect(setWorkItemResources(shop.db, { workItemId: job, resourceIds: [] })).resolves.toBeUndefined();
    });

    it('reads current configuration: a resource that loses a capability stops covering, with history untouched', async () => {
      const { typeId, statusId } = await type(shop, 'Current');
      await createResourceRequirement(shop.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [shop.mobile] });
      const holder = await createResource(shop.db, { organizationId: shop.organizationId, name: 'Temp', resourceClass: 'person', capabilityIds: [shop.mobile] });
      const job = await createWorkItem(shop.db, { organizationId: shop.organizationId, title: 'Temp job', statusId, resourceIds: [holder] });

      const covered = async () =>
        (await evaluateWorkItems(shop.db, { organizationId: shop.organizationId, items: [{ workItemId: job, typeId, resourceIds: [holder] }] })).get(job)!.satisfied;
      expect(await covered()).toBe(true);

      await removeResourceCapability(shop.db, { resourceId: holder, capabilityId: shop.mobile });
      expect(await covered()).toBe(false);
      // The assignment itself was not touched.
      const rows = await pg.query('select 1 from public.work_item_resource_assignments where work_item_id = $1 and resource_id = $2', [job, holder]);
      expect(rows.rowCount).toBe(1);
    });
  });

  describe('public booking', () => {
    async function bookingShop(label: string, requirement?: { resourceClass: 'person'; capabilityIds: string[] }) {
      const t = await newShop(label);
      const org = await getOrganization(t.db, t.organizationId);
      await updateOrganization(t.db, {
        id: t.organizationId,
        name: org!.name,
        timezone: org!.timezone,
        currency: org!.currency!,
        bufferMinutes: 0,
        slug: `${label}-${randomUUID().slice(0, 6)}`,
      });
      // Only the people: this is about which person may be offered.
      await pg.query(`delete from public.resources where organization_id = $1 and resource_class <> 'person'`, [t.organizationId]);
      await addOperatingHours(t.db, { organizationId: t.organizationId, dayOfWeek: 1, opensAt: '09:00', closesAt: '11:00' });
      await setModuleEnabled(t.db, { organizationId: t.organizationId, key: 'booking', enabled: true });
      const made = await type(t, 'Oil Change');
      if (requirement) {
        await createResourceRequirement(t.db, { typeId: made.typeId, quantity: 1, ...requirement });
      }
      await setTypeBookable(t.db, { id: made.typeId, statusId: made.statusId, durationMinutes: 60 });
      return { t, ...made };
    }

    const visitor = async (organizationId: string) => {
      const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await beginBooking(db, { organizationId });
      return db;
    };
    const offered = async (organizationId: string) => {
      const db = await visitor(organizationId);
      const [bookable] = await listBookableTypes(db, { organizationId });
      const slots = await bookableSlots(db, { organizationId, type: bookable, date: '2027-04-05', timeZone: 'UTC' });
      return { db, bookable, slots };
    };

    it('with no requirements behaves exactly as before: every resource is a candidate', async () => {
      const { t } = await bookingShop('wtr-none');
      const { slots } = await offered(t.organizationId);
      // Two people free at nine and ten, one offer per instant.
      expect(slots.map((s) => s.startsAt.slice(11, 16))).toEqual(['09:00', '10:00']);
    });

    it('with one one-resource requirement offers only eligible capacity, and the commit reasserts eligibility', async () => {
      const { t, statusId } = await bookingShop('wtr-one', { resourceClass: 'person', capabilityIds: [] });
      // Narrow to people who can do tires: Alex only.
      const [{ id }] = await listResourceRequirements(t.db, { organizationId: t.organizationId });
      await updateResourceRequirement(t.db, { id, resourceClass: 'person', quantity: 1, capabilityIds: [t.tire] });

      const { db, bookable, slots } = await offered(t.organizationId);
      expect(slots.length).toBeGreaterThan(0);

      // Block Alex at nine and only the eligible capacity is consulted: ten remains, nothing from Jo.
      const job = await createWorkItem(t.db, { organizationId: t.organizationId, title: 'Alex at nine', statusId, resourceIds: [t.alex] });
      await scheduleWorkItem(t.db, { workItemId: job, startsAt: '2027-04-05T09:00:00.000Z', endsAt: '2027-04-05T10:00:00.000Z' });
      const after = await offered(t.organizationId);
      expect(after.slots.map((s) => s.startsAt.slice(11, 16))).toEqual(['10:00']);

      // A hand-written commit for an ineligible resource — the visitor never saw Jo — is refused at the database.
      const raw = await db.rpc('create_booking', {
        p_organization_id: t.organizationId,
        p_type_id: bookable.id,
        p_allocations: [{ requirement_id: id, resource_id: t.jo }],
        p_starts_at: '2027-04-05T10:00:00.000Z',
        p_name: 'Forged',
        p_email: 'forged@example.test',
        p_phone: '',
      });
      expect(raw.error?.code).toBe('GD012');

      // And the eligible one books, to the resource the slot named, without revealing it publicly.
      const ok = await bookSlot(db, { organizationId: t.organizationId, typeId: bookable.id, slot: after.slots[0], name: 'Real', email: 'real@example.test', phone: '' });
      const rows = await pg.query('select resource_id from public.work_item_resource_assignments where work_item_id = $1', [ok]);
      expect(rows.rows).toEqual([{ resource_id: t.alex }]);
    });

    it('eligibility changes between the offer and the booking are caught at commit', async () => {
      const { t } = await bookingShop('wtr-race', { resourceClass: 'person', capabilityIds: [] });
      const [{ id }] = await listResourceRequirements(t.db, { organizationId: t.organizationId });
      await updateResourceRequirement(t.db, { id, resourceClass: 'person', quantity: 1, capabilityIds: [t.tire] });
      const { db, bookable, slots } = await offered(t.organizationId);

      // Alex loses the capability after the page was built.
      await pg.query('delete from public.resource_capability_assignments where resource_id = $1 and capability_id = $2', [t.alex, t.tire]);
      await expect(
        bookSlot(db, { organizationId: t.organizationId, typeId: bookable.id, slot: slots[0], name: 'Late', email: 'late@example.test', phone: '' }),
      ).rejects.toMatchObject({ code: 'booking.slot_taken' });
    });

    it('publishes a type that needs several resources, and lets a published type grow', async () => {
      const t = await newShop('wtr-compat');
      await setModuleEnabled(t.db, { organizationId: t.organizationId, key: 'booking', enabled: true });

      // The one-resource limit is gone: quantity above one and several requirements both publish.
      const many = await type(t, 'Two people');
      await createResourceRequirement(t.db, { typeId: many.typeId, resourceClass: 'person', quantity: 2, capabilityIds: [] });
      await expect(setTypeBookable(t.db, { id: many.typeId, statusId: many.statusId, durationMinutes: 60 })).resolves.toBeUndefined();

      const pair = await type(t, 'Person and van');
      await createResourceRequirement(t.db, { typeId: pair.typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] });
      await createResourceRequirement(t.db, { typeId: pair.typeId, resourceClass: 'vehicle', quantity: 1, capabilityIds: [] });
      const raw = await t.db.rpc('set_type_bookable', { p_id: pair.typeId, p_status_id: pair.statusId, p_duration_minutes: 60, p_price_item_id: null as unknown as string });
      expect(raw.error).toBeNull();

      // A published type accepts more requirements, written through the domain or directly.
      const single = await type(t, 'One person');
      await setTypeBookable(t.db, { id: single.typeId, statusId: single.statusId, durationMinutes: 60 });
      const id = await createResourceRequirement(t.db, { typeId: single.typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] });
      await expect(createResourceRequirement(t.db, { typeId: single.typeId, resourceClass: 'vehicle', quantity: 1, capabilityIds: [] })).resolves.toBeTruthy();
      await expect(updateResourceRequirement(t.db, { id, resourceClass: 'person', quantity: 2, capabilityIds: [] })).resolves.toBeUndefined();
    });

    it('verifies the allocation a booking is handed, rather than choosing one', async () => {
      const { t, typeId } = await bookingShop('wtr-hard', { resourceClass: 'person', capabilityIds: [] });
      await createResourceRequirement(t.db, { typeId, resourceClass: 'vehicle', quantity: 1, capabilityIds: [] });
      const van = await createResource(t.db, { organizationId: t.organizationId, name: 'Van', resourceClass: 'vehicle' });
      const [person, vehicle] = await listResourceRequirements(t.db, { organizationId: t.organizationId, typeId });
      const { db, bookable } = await offered(t.organizationId);
      const book = (allocations: unknown) =>
        db.rpc('create_booking', {
          p_organization_id: t.organizationId,
          p_type_id: bookable.id,
          p_allocations: allocations as never,
          p_starts_at: '2027-04-05T09:00:00.000Z',
          p_name: 'X',
          p_email: 'x@example.test',
          p_phone: '',
        });

      // A slot left empty, a resource used twice, and a resource that cannot do the role: each refused.
      expect((await book([{ requirement_id: person.id, resource_id: t.alex }])).error?.code).toBe('GD014');
      expect((await book([{ requirement_id: person.id, resource_id: t.alex }, { requirement_id: vehicle.id, resource_id: t.alex }])).error?.code).toBe('GD014');
      expect((await book([{ requirement_id: person.id, resource_id: t.alex }, { requirement_id: vehicle.id, resource_id: t.jo }])).error?.code).toBe('GD012');
      expect((await book([{ requirement_id: null, resource_id: t.alex }])).error?.code).toBe('GD014');

      // And the whole of it commits, with every assignment, once.
      const ok = await book([{ requirement_id: person.id, resource_id: t.alex }, { requirement_id: vehicle.id, resource_id: van }]);
      expect(ok.error).toBeNull();
      const rows = await pg.query('select resource_id from public.work_item_resource_assignments where work_item_id = $1 order by resource_id', [ok.data]);
      expect(rows.rows.map((r) => r.resource_id).sort()).toEqual([t.alex, van].sort());
    });
  });

  describe('setup', () => {
    it('says when the business has fewer eligible resources than a kind of work needs — a count, not availability', async () => {
      const t = await newShop('wtr-setup');
      const area = async () =>
        (await computeSetupOverview(t.db, { organizationId: t.organizationId })).areas.find((entry) => entry.key === 'resource-capacity');

      // Nothing required, nothing to ask.
      expect(await area()).toBeUndefined();

      const { typeId } = await type(t, 'Installation');
      await createResourceRequirement(t.db, { typeId, resourceClass: 'person', quantity: 2, capabilityIds: [t.tire] });
      const short = await area();
      expect(short).toMatchObject({ state: 'incomplete', importance: 'optional' });
      expect(short!.message).toContain('Installation needs 2 × Person · Tire service; 1 exists.');

      // A second eligible person, and it is complete — whatever either of them is doing at the time.
      await createResource(t.db, { organizationId: t.organizationId, name: 'Sam', resourceClass: 'person', capabilityIds: [t.tire] });
      expect(await area()).toMatchObject({ state: 'complete' });
    });
  });
});
