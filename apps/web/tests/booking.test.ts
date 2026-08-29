import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  beginBooking,
  bookSlot,
  bookableSlots,
  listBookableTypes,
  resolveBookingSlug,
} from '@/lib/domain/booking/booking';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { createResource } from '@/lib/domain/resources/resources';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { listWorkItems } from '@/lib/domain/work-items/work-items';

/**
 * D22's axis, and the first surface that pays for it.
 *
 * Every other suite here signs in as a member. This one is mostly a stranger — somebody who
 * holds no membership, no role and no capability, and who must nonetheless be able to see what
 * a business publishes and commit it to a time.
 *
 * **The assertion that carries the whole record is `app.current_tenant_ids()` staying empty.**
 * D22 rejected a membership row with a `customer` role as "by far the cheapest" and "also the
 * leak", because a membership puts an outsider inside that function's result and every table's
 * policies then return rows to them. So the test does not merely check that a stranger cannot
 * read the wrong thing; it checks that the mechanism which would make them able to has not
 * been used, at every point including the ones where they successfully wrote.
 *
 * **I6 is proved here rather than described.** The slot is read, a second party takes it, and
 * the booking is committed against the stale answer — which is refused by the exclusion
 * constraint in the transaction that would have written it. Nothing checks first, because a
 * check before an insert races identically.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const DATE = '2027-03-15';
const ZONE = 'America/Toronto';

type Business = {
  db: SupabaseClient;
  organizationId: string;
  typeId: string;
  statusId: string;
  resourceId: string;
  priceItemId: string;
  slug: string;
};

let pneu: Business;
let rival: Business;

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function newBusiness(label: string, opts: { publish: boolean }): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Unique per run, because a slug is unique across the whole platform by design and this
  // suite runs against a database it does not own exclusively.
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: 'Owner',
    p_timezone: ZONE,
    p_currency: 'CAD',
  });
  if (error) throw error;

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Tyre change' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: orgId,
    typeId,
    name: 'Requested',
  });
  const resourceId = await createResource(db, { organizationId: orgId, name: 'Van 1' });
  const priceItemId = await createPriceBookItem(db, {
    organizationId: orgId,
    name: 'Seasonal tyre change',
    unit: 'visit',
    unitAmountMinor: 12_000,
  });

  // 09:00–12:00 on the Monday this test books. Nothing seeds a working week, so a business
  // that says nothing is open all day — which would make the slot assertions meaningless.
  await addOperatingHours(db, {
    organizationId: orgId,
    dayOfWeek: 1,
    opensAt: '09:00',
    closesAt: '12:00',
  });

  if (opts.publish) {
    // Publishing is two decisions and this business makes both: the module says the public
    // page exists at all, and a bookable type says what is on it. A business that does one
    // without the other has no public presence — see `modules.test.ts`.
    await setModuleEnabled(db, { organizationId: orgId, key: 'booking', enabled: true });
    await setTypeBookable(db, {
      id: typeId,
      statusId,
      durationMinutes: 60,
      priceItemId,
    });
  }

  // The public address, which the business chooses and the platform never invents.
  const organization = await getOrganization(db, orgId);
  await updateOrganization(db, {
    id: orgId,
    name: organization!.name,
    timezone: organization!.timezone,
    currency: organization!.currency,
    bufferMinutes: organization!.bufferMinutes,
    slug,
  });

  return { db, organizationId: orgId, typeId, statusId, resourceId, priceItemId, slug };
}

/** A member of the public: no membership, no role, no capability, no account. */
async function visitor(organizationId: string): Promise<SupabaseClient> {
  const db = anonClient();
  await beginBooking(db, { organizationId });
  return db;
}

describe('booking, by somebody who is a member of nothing', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    pneu = await newBusiness('bk-pneu', { publish: true });
    rival = await newBusiness('bk-rival', { publish: true });
  });

  it('is reached by a name the business chose, not by its tenant id', async () => {
    // The booking surface first shipped at `/book/{organizationId}`, which published a tenant
    // id and — worse — let a path segment decide which business an anonymous visitor was bound
    // to. D17 says a segment is routing convenience and never an authorization input; under
    // `/organizations/[organizationId]` that holds because RLS re-derives membership, and out
    // here there is no membership to re-derive against.
    const anonymous = anonClient();
    expect(await resolveBookingSlug(anonymous, pneu.slug)).toBe(pneu.organizationId);

    // Case and surrounding space are the visitor's typing, not a different business.
    expect(await resolveBookingSlug(anonymous, `  ${pneu.slug.toUpperCase()} `)).toBe(
      pneu.organizationId,
    );
  });

  it('gives a business that publishes nothing no public presence at all', async () => {
    // Opt-in, and this is the half that matters. Before the slug, anybody holding a uuid could
    // bind themselves to any organization — they could then see nothing, but the binding
    // existed. A business with no bookable type is now simply not addressable.
    const quiet = await newBusiness('bk-silent', { publish: false });
    const anonymous = anonClient();

    expect(await resolveBookingSlug(anonymous, quiet.slug)).toBeNull();
    expect(await resolveBookingSlug(anonymous, 'no-such-business')).toBeNull();
    expect(quiet.organizationId).toBeTypeOf('string');
  });

  it('refuses a public address another business already uses', async () => {
    const organization = await getOrganization(rival.db, rival.organizationId);
    await expect(
      updateOrganization(rival.db, {
        id: rival.organizationId,
        name: organization!.name,
        timezone: organization!.timezone,
        currency: organization!.currency,
        bufferMinutes: organization!.bufferMinutes,
        slug: pneu.slug,
      }),
    ).rejects.toMatchObject({ code: 'organizations.slug_taken' });
  });

  it('refuses an address that is not a public address', async () => {
    const organization = await getOrganization(rival.db, rival.organizationId);
    await expect(
      updateOrganization(rival.db, {
        id: rival.organizationId,
        name: organization!.name,
        timezone: organization!.timezone,
        currency: organization!.currency,
        bufferMinutes: organization!.bufferMinutes,
        slug: 'Pneu 3L!',
      }),
    ).rejects.toMatchObject({ code: 'organizations.slug_invalid' });
  });

  it('is in no tenant at all, which is the whole of D22', async () => {
    const db = await visitor(pneu.organizationId);

    // The rejected design was a membership row with a `customer` role. This is the assertion
    // that it was not quietly reintroduced: the function every capability check runs through
    // returns nothing for this caller, so no policy keyed to it can ever return them a row.
    const { data } = await db.from('memberships').select('id');
    expect(data).toEqual([]);

    // And the organizations they can see is exactly one, through the external policy rather
    // than through membership.
    const { data: orgs } = await db.from('organizations').select('id');
    expect(orgs!.map((row) => row.id)).toEqual([pneu.organizationId]);
  });

  it('sees what the business published and nothing else', async () => {
    const db = await visitor(pneu.organizationId);
    const types = await listBookableTypes(db, { organizationId: pneu.organizationId });

    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('Tyre change');
    expect(types[0].durationMinutes).toBe(60);
    expect(types[0].price).toEqual({
      amountMinor: 12_000,
      currency: 'CAD',
      description: 'Seasonal tyre change',
    });
  });

  it('cannot see a type the business has not published', async () => {
    // A second type exists and has no booking status, so it is not published. There is no
    // `bookable` flag to forget to set — the absence of a status is what unpublished means.
    await createWorkItemType(pneu.db, { organizationId: pneu.organizationId, name: 'Internal' });

    const db = await visitor(pneu.organizationId);
    const types = await listBookableTypes(db, { organizationId: pneu.organizationId });
    expect(types.map((type) => type.name)).toEqual(['Tyre change']);
  });

  it('is never told who anyone is', async () => {
    const db = await visitor(pneu.organizationId);

    // A resource can be a person (D19). A stranger learns that something is free, never who.
    const { data: named } = await db.from('resources').select('id, name');
    expect(named ?? []).toEqual([]);

    const { data: ids } = await db.from('bookable_resources').select('id');
    expect(ids!.map((row) => row.id)).toEqual([pneu.resourceId]);

    // And no customer, no work item, no member of staff.
    const { data: customers } = await db.from('customers').select('id');
    expect(customers).toEqual([]);
  });

  it('offers slots inside the business’s own opening hours', async () => {
    const db = await visitor(pneu.organizationId);
    const [type] = await listBookableTypes(db, { organizationId: pneu.organizationId });

    const slots = await bookableSlots(db, {
      organizationId: pneu.organizationId,
      type,
      date: DATE,
      timeZone: ZONE,
    });

    // 09:00, 10:00, 11:00 local — three hour-long slots in a three-hour morning. Nothing
    // outside it, because operating hours are subtracted by the same calculation the operator
    // sees (I5) rather than by a second one written for this page.
    expect(slots).toHaveLength(3);
    const local = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: ZONE });
    expect(slots.map((slot) => local.format(new Date(slot.startsAt)))).toEqual([
      '09:00',
      '10:00',
      '11:00',
    ]);
  });

  it('takes a booking, and the business can see it', async () => {
    const db = await visitor(pneu.organizationId);
    const [type] = await listBookableTypes(db, { organizationId: pneu.organizationId });
    const slots = await bookableSlots(db, {
      organizationId: pneu.organizationId,
      type,
      date: DATE,
      timeZone: ZONE,
    });

    const workItemId = await bookSlot(db, {
      organizationId: pneu.organizationId,
      typeId: type.id,
      slot: slots[0],
      name: 'Ariane Blais',
      email: 'ariane@example.test',
      phone: '',
    });

    // The operator's side: a real work item, in the status the business said bookings arrive
    // in, against a real customer, scheduled on a resource.
    const items = await listWorkItems(pneu.db, { organizationId: pneu.organizationId });
    const booked = items.find((item) => item.id === workItemId)!;
    expect(booked.status.id).toBe(pneu.statusId);
    expect(booked.customer?.label).toBe('Ariane Blais');
    expect(booked.window).not.toBeNull();

    // Priced from the catalogue by the same copy every quote gets (I4, I8) — the visitor
    // never sent an amount, and could not have.
    const lines = await listPricedLines(pneu.db, {
      organizationId: pneu.organizationId,
      workItemId,
    });
    expect(priceWorkItem(lines)).toEqual({ totalMinor: 12_000, currency: 'CAD' });
  });

  it('is advisory, and the constraint is the re-assertion (I6)', async () => {
    const db = await visitor(pneu.organizationId);
    const [type] = await listBookableTypes(db, { organizationId: pneu.organizationId });

    // Read availability...
    const slots = await bookableSlots(db, {
      organizationId: pneu.organizationId,
      type,
      date: DATE,
      timeZone: ZONE,
    });
    const wanted = slots[0];

    // ...let somebody else take it in the meantime...
    const other = await visitor(pneu.organizationId);
    await bookSlot(other, {
      organizationId: pneu.organizationId,
      typeId: type.id,
      slot: wanted,
      name: 'Someone Faster',
      email: 'faster@example.test',
      phone: '',
    });

    // ...and commit against the stale answer. Nothing checked first, on purpose.
    await expect(
      bookSlot(db, {
        organizationId: pneu.organizationId,
        typeId: type.id,
        slot: wanted,
        name: 'Ariane Blais',
        email: 'ariane@example.test',
        phone: '',
      }),
    ).rejects.toMatchObject({ code: 'booking.slot_taken' });
  });

  it('can read back its own booking and no other', async () => {
    const db = await visitor(pneu.organizationId);
    const [type] = await listBookableTypes(db, { organizationId: pneu.organizationId });
    const slots = await bookableSlots(db, {
      organizationId: pneu.organizationId,
      type,
      date: DATE,
      timeZone: ZONE,
    });

    const mine = await bookSlot(db, {
      organizationId: pneu.organizationId,
      typeId: type.id,
      slot: slots[0],
      name: 'Reads Back',
      email: 'reads@example.test',
      phone: '',
    });

    const { data } = await db.from('work_items').select('id, title');
    expect(data!.map((row) => row.id)).toEqual([mine]);
  });

  it('books once and only once', async () => {
    // Its own business, because the assertion is about the *second* slot being refused for
    // the right reason — in a diary the other tests have been filling, it would be refused
    // for having been taken, which is a different claim entirely.
    const quiet = await newBusiness('bk-once', { publish: true });
    const db = await visitor(quiet.organizationId);
    const [type] = await listBookableTypes(db, { organizationId: quiet.organizationId });
    const slots = await bookableSlots(db, {
      organizationId: quiet.organizationId,
      type,
      date: DATE,
      timeZone: ZONE,
    });

    await bookSlot(db, {
      organizationId: quiet.organizationId,
      typeId: type.id,
      slot: slots[0],
      name: 'Books Once',
      email: 'once@example.test',
      phone: '',
    });

    // One anonymous session, one booking. Without this a single visitor could fill the diary,
    // and the binding is the only thing that identifies them. It carries its own SQLSTATE
    // rather than 23505, which a duplicate email also raises and which means the opposite.
    await expect(
      bookSlot(db, {
        organizationId: quiet.organizationId,
        typeId: type.id,
        slot: slots[1],
        name: 'Books Twice',
        email: 'twice@example.test',
        phone: '',
      }),
    ).rejects.toMatchObject({ code: 'booking.already_booked' });
  });

  it('lets a returning customer book against the record they already have', async () => {
    // The case that rewrote this migration. `customers_org_email_unique` refuses a second row
    // for one address, and a read policy narrow enough to be safe cannot see the customer
    // already there — so the write side became one privileged function rather than four
    // permissive policies, and the surface got smaller for it.
    const shop = await newBusiness('bk-return', { publish: true });

    const first = await visitor(shop.organizationId);
    const [type] = await listBookableTypes(first, { organizationId: shop.organizationId });
    const slots = await bookableSlots(first, {
      organizationId: shop.organizationId,
      type,
      date: DATE,
      timeZone: ZONE,
    });
    await bookSlot(first, {
      organizationId: shop.organizationId,
      typeId: type.id,
      slot: slots[0],
      name: 'Ariane Blais',
      email: 'ariane@returns.test',
      phone: '',
    });

    // A month later, a new session, the same person.
    const again = await visitor(shop.organizationId);
    const later = await bookableSlots(again, {
      organizationId: shop.organizationId,
      type,
      date: DATE,
      timeZone: ZONE,
    });
    await bookSlot(again, {
      organizationId: shop.organizationId,
      typeId: type.id,
      slot: later[0],
      name: 'Ariane Blais',
      email: 'ariane@returns.test',
      phone: '',
    });

    // One customer, two jobs — not a refusal, and not a duplicate record.
    const { data: customers } = await shop.db
      .from('customers')
      .select('id')
      .eq('organization_id', shop.organizationId)
      .eq('email', 'ariane@returns.test');
    expect(customers).toHaveLength(1);

    const items = await listWorkItems(shop.db, { organizationId: shop.organizationId });
    expect(items.filter((item) => item.customer?.id === customers![0].id)).toHaveLength(2);
  });

  it('is scoped to one business and cannot reach another, even holding its id', async () => {
    const db = await visitor(pneu.organizationId);

    // The scope function returns at most one organization. Everything below follows from that
    // rather than from a filter anybody wrote.
    const rivalTypes = await listBookableTypes(db, { organizationId: rival.organizationId });
    expect(rivalTypes).toEqual([]);

    const { data: orgs } = await db.from('organizations').select('id').eq('id', rival.organizationId);
    expect(orgs).toEqual([]);

    const { data: commitments } = await db
      .from('resource_commitments')
      .select('resource_id')
      .eq('organization_id', rival.organizationId);
    expect(commitments).toEqual([]);
  });

  it('cannot re-scope itself to another business', async () => {
    const db = await visitor(pneu.organizationId);

    // The unique index is on `user_id` alone — deliberately not led by `organization_id`, which
    // is the one place in this schema I2's shape would be wrong. Leading with the tenant would
    // permit exactly this row, and `app.current_external_tenant()` would then have a set.
    const { data: user } = await db.auth.getUser();
    const { error } = await db
      .from('external_actors')
      .insert({ organization_id: rival.organizationId, user_id: user.user!.id });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23505');
  });

  it('cannot write anything it was not permitted, including into its own tenant', async () => {
    const db = await visitor(pneu.organizationId);

    // **A stranger holds no insert permission on any table at all.** The first draft of this
    // axis gave them four, scoped to their own tenant; the write side is now one privileged
    // function with a scope check, so there is exactly one shape of write they can perform and
    // this list is everything else.
    const { data: user } = await db.auth.getUser();
    const { error: customer } = await db
      .from('customers')
      .insert({ organization_id: pneu.organizationId, name: 'Direct', created_by: user.user!.id });
    expect(customer).not.toBeNull();

    const { error: item } = await db.from('work_items').insert({
      organization_id: pneu.organizationId,
      type_id: pneu.typeId,
      status_id: pneu.statusId,
      title: 'Direct',
      created_by: user.user!.id,
    });
    expect(item).not.toBeNull();

    const { error: role } = await db
      .from('roles')
      .insert({ organization_id: pneu.organizationId, name: 'Sneaky', capabilities: [] });
    expect(role).not.toBeNull();

    const { error: type } = await db
      .from('work_item_types')
      .insert({ organization_id: pneu.organizationId, name: 'Mine now' });
    expect(type).not.toBeNull();

    const { error: hours } = await db
      .from('operating_hours')
      .insert({ organization_id: pneu.organizationId, weekday: 2, opens_at: '00:00', closes_at: '23:59' });
    expect(hours).not.toBeNull();
  });

  it('leaves the booking attributable (I11)', async () => {
    // An anonymous visitor is still a genuine `auth.users` row, which is why I11 needed no
    // second shape. The business can see that somebody booked, and when.
    const { data } = await pneu.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', pneu.organizationId)
      .eq('action', 'work_item.booked');

    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((event) => typeof event.actor_id === 'string')).toBe(true);
  });

  it('shows a business with nothing published no way in', async () => {
    const quiet = await newBusiness('bk-quiet', { publish: false });
    const db = await visitor(quiet.organizationId);

    expect(await listBookableTypes(db, { organizationId: quiet.organizationId })).toEqual([]);
  });
});
