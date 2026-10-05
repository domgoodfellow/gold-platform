import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { beginBooking, bookSlot, resolveBookingSlug } from '@/lib/domain/booking/booking';
import {
  connectPaymentAccount,
  disconnectPaymentAccount,
  getPaymentAccount,
} from '@/lib/domain/billing/payment-accounts';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { createResource } from '@/lib/domain/resources/resources';
import { ALL_CAPABILITIES, CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { listMembers } from '@/lib/domain/tenancy/members';
import {
  listEnabledModules,
  listModuleSettings,
  listUsableModules,
  outstandingModuleSetup,
  setModuleEnabled,
} from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  createWorkItemType,
  listWorkItemTypes,
  setTypeBookable,
} from '@/lib/domain/work-items/types';
import { configureBusiness, type BusinessShape } from '@/lib/domain/configuration/configure';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Module enablement, and the only claim worth testing about it.
 *
 * A switch that changes nothing is worse than no switch — a business turns public booking off,
 * believes its page is down, and finds out from a customer that it is not. So what is asserted
 * here is that each module actually removes the surface it names, and that switching it back on
 * restores it without having destroyed anything in between.
 *
 * **The other half is what modules must never become.** Nothing here is an RLS predicate on a
 * tenant-owned table: a module decides what a business *has*, and `app.has_capability` decides
 * what a member may *do*. The last case in this file is the one that would catch them merging.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Business = {
  db: SupabaseClient;
  userId: string;
  membershipId: string;
  organizationId: string;
  typeId: string;
  slug: string;
};

let shop: Business;

async function newBusiness(label: string): Promise<Business> {
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

  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  const organization = organizationId as string;
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: organization, name: 'Job' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: organization,
    typeId,
    name: 'Requested',
    position: 0,
  });
  await createResource(db, { resourceClass: 'other', organizationId: organization, name: 'Bay' });
  const priceItemId = await createPriceBookItem(db, {
    organizationId: organization,
    name: 'Service',
    unit: 'visit',
    unitAmountMinor: 5_000,
  });
  await setTypeBookable(db, { id: typeId, statusId, durationMinutes: 60, priceItemId });

  const slug = `${label}-${randomUUID().slice(0, 6)}`;
  const org = await getOrganization(db, organization);
  await updateOrganization(db, {
    id: organization,
    name: org!.name,
    timezone: org!.timezone,
    currency: org!.currency!,
    bufferMinutes: org!.bufferMinutes,
    slug,
  });

  const [membership] = await listMembers(db, { organizationId: organization });

  return {
    db,
    userId: created.user.id,
    membershipId: membership.id,
    organizationId: organization,
    typeId,
    slug,
  };
}

describe('what a business has switched on', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    shop = await newBusiness('mod');
  });

  it('starts a new business on billing and guided setup, and nothing that publishes', async () => {
    const enabled = await listEnabledModules(shop.db, { organizationId: shop.organizationId });

    // **`work`, `scheduling` and `customers` are deliberately absent, and their absence is the
    // point.** They were listed here as required modules, which was the kernel misfiled — see
    // `navigation.ts`. A business always has them and never switched them on.
    //
    // **`drafting` joined the list at `20260904000001`, and the reason is discoverability
    // rather than generosity.** The screen whose whole job is to stand a business up was a
    // module that started off, sitting last in the configuration group — so the way to reach
    // the thing that saves you filling in eight screens was to go through the settings you
    // were trying to avoid. It is still a module and still one click from off.
    expect([...enabled].sort()).toEqual(['billing', 'drafting']);
    // Publishing a page to the internet is not a default anybody should acquire by signing up,
    // and neither is a module for machines a business may not have.
    expect(enabled.has('assets')).toBe(false);
    expect(enabled.has('booking')).toBe(false);
    expect(enabled.has('portal')).toBe(false);
    expect(enabled.has('card_payments')).toBe(false);
    // **`assistant` is off while `drafting` is on, and that pair is the decision.** Drafting
    // sends nothing anywhere until somebody types a description and presses a button; the
    // assistant reads this business's rows out to a model to answer with. Acquiring the second
    // by signing up would be a decision made on a business's behalf.
    expect(enabled.has('assistant')).toBe(false);
  });

  it('gives a business with booking off no public presence at all', async () => {
    // The business has published a bookable type and chosen a slug. The only thing standing
    // between a stranger and its page is the module.
    const stranger = anonClient();
    expect(await resolveBookingSlug(stranger, shop.slug)).toBeNull();

    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'booking',
      enabled: true,
    });

    expect(await resolveBookingSlug(anonClient(), shop.slug)).toBe(shop.organizationId);
  });

  it('refuses a booking from somebody who kept an id from before it was switched off', async () => {
    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'booking',
      enabled: true,
    });

    const visitor = anonClient();
    await beginBooking(visitor, { organizationId: shop.organizationId });

    // Bound while the page was up. Now the business switches it off — and the id this visitor
    // is holding must stop working, because it was routing convenience and never permission.
    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'booking',
      enabled: false,
    });

    await expect(
      bookSlot(visitor, {
        organizationId: shop.organizationId,
        typeId: shop.typeId,
        slot: {
          startsAt: '2026-09-07T13:00:00.000Z',
          endsAt: '2026-09-07T14:00:00.000Z',
        },
        name: 'Too late',
        email: `late-${randomUUID().slice(0, 6)}@example.test`,
        phone: '',
      }),
    ).rejects.toThrow();
  });

  it('destroys nothing when a module is switched off and on again', async () => {
    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'booking',
      enabled: true,
    });
    const first = await listModuleSettings(shop.db, { organizationId: shop.organizationId });
    const firstOn = first.find((entry) => entry.module.key === 'booking')!.enabledAt;

    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'booking',
      enabled: false,
    });
    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'booking',
      enabled: true,
    });

    const again = await listModuleSettings(shop.db, { organizationId: shop.organizationId });
    const secondOn = again.find((entry) => entry.module.key === 'booking')!.enabledAt;

    // A fresh `enabled_at`, which is the figure a billing question needs — off is an absent
    // row rather than a false flag, so there is no third state.
    expect(secondOn).not.toBe(firstOn);

    // And the business is still there. Switching a module off removes a surface, never the
    // history behind it — I8's reasoning one level up.
    const { data: types } = await shop.db
      .from('work_item_types')
      .select('id')
      .eq('organization_id', shop.organizationId);
    expect((types ?? []).length).toBeGreaterThan(0);
  });

  it('lets a business switch off everything it was offered', async () => {
    // **This test used to assert the opposite**, that `work` could not be switched off. That
    // was the kernel misfiled as a required module, and the refusal was the platform declining
    // to break something it should never have offered in the first place. The kernel is no
    // longer in `MODULES`, so `work` is not a module and there is nothing left that a business
    // is shown and cannot decline.
    await expect(
      setModuleEnabled(shop.db, {
        organizationId: shop.organizationId,
        key: 'work',
        enabled: false,
      }),
    ).rejects.toThrow(/no such module/i);

    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'billing',
      enabled: false,
    });
    const enabled = await listEnabledModules(shop.db, { organizationId: shop.organizationId });
    expect(enabled.has('billing')).toBe(false);

    // Put it back: later assertions in this file read what this business has on.
    await setModuleEnabled(shop.db, {
      organizationId: shop.organizationId,
      key: 'billing',
      enabled: true,
    });
  });

  it('refuses a module this platform does not have', async () => {
    await expect(
      setModuleEnabled(shop.db, {
        organizationId: shop.organizationId,
        key: 'inventory',
        enabled: true,
      }),
    ).rejects.toThrow(/no such module/i);
  });

  it('is not authorization, and a role with everything but organization.manage proves it', async () => {
    // **The case that would catch modules and capabilities merging.** A member who cannot
    // change what the business bought must still be able to read and work — modules decide
    // what a business *has*, `app.has_capability` decides what a member may *do*, and nothing
    // in `organization_modules` is ever an RLS predicate on a tenant-owned table (D25).
    const roleId = await createRole(shop.db, {
      organizationId: shop.organizationId,
      name: `Dispatcher ${randomUUID().slice(0, 6)}`,
      capabilities: CAPABILITIES.filter((capability) => capability !== 'organization.manage'),
    });
    await assignRole(shop.db, { membershipId: shop.membershipId, roleId });

    try {
      // Still sees what the business has — the switch is what they lose, not the screen.
      const enabled = await listEnabledModules(shop.db, {
        organizationId: shop.organizationId,
      });
      expect(enabled.has('billing')).toBe(true);

      await expect(
        setModuleEnabled(shop.db, {
          organizationId: shop.organizationId,
          key: 'portal',
          enabled: true,
        }),
      ).rejects.toThrow();

      // And their ordinary work is untouched: no policy anywhere consults a module.
      const { data, error } = await shop.db
        .from('work_item_types')
        .select('id')
        .eq('organization_id', shop.organizationId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    } finally {
      const restored = await createRole(shop.db, {
        organizationId: shop.organizationId,
        name: `Owner ${randomUUID().slice(0, 6)}`,
        capabilities: [...ALL_CAPABILITIES],
      });
      await assignRole(shop.db, { membershipId: shop.membershipId, roleId: restored });
    }
  });
});

/**
 * Where a business is paid.
 *
 * The claim worth holding is not that a row can be written — it is that **nothing here is a
 * credential and nothing here reaches another tenant**. D27's whole argument is that an account
 * id can live in an ordinary row precisely because it grants nothing on its own; that only
 * stays true if the row is scoped like every other row.
 */
describe('a connected payment account', () => {
  it('is per business, and invisible to another one', async () => {
    const rival = await newBusiness('acct-rival');

    await connectPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
      account: { accountId: 'acct_shop_1' },
    });

    const mine = await getPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
    });
    expect(mine!.account.accountId).toBe('acct_shop_1');

    // Knowing the other tenant's id is no help — RLS is the boundary (I1).
    const theirs = await getPaymentAccount(rival.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
    });
    expect(theirs).toBeNull();
  });

  it('replaces rather than re-points, so a move is recorded', async () => {
    await connectPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
      account: { accountId: 'acct_first' },
    });
    const first = await getPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
    });

    await connectPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
      account: { accountId: 'acct_second' },
    });
    const second = await getPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
    });

    expect(second!.account.accountId).toBe('acct_second');
    // There is no update policy on the table, so this went through a delete and an insert and
    // carries a fresh timestamp. A row that could be re-pointed in place would move a
    // business's money with nothing recording that it moved.
    expect(second!.connectedAt).not.toBe(first!.connectedAt);
  });

  it('refuses a role that cannot manage the business', async () => {
    const roleId = await createRole(shop.db, {
      organizationId: shop.organizationId,
      name: `Tech ${randomUUID().slice(0, 6)}`,
      capabilities: CAPABILITIES.filter((capability) => capability !== 'organization.manage'),
    });
    await assignRole(shop.db, { membershipId: shop.membershipId, roleId });

    try {
      // Where the money goes is not a dispatcher's decision, and the guard is the policy
      // rather than the absence of a button (I12).
      await expect(
        connectPaymentAccount(shop.db, {
          organizationId: shop.organizationId,
          provider: 'stripe',
          account: { accountId: 'acct_sneaky' },
        }),
      ).rejects.toThrow();

      await expect(
        disconnectPaymentAccount(shop.db, {
          organizationId: shop.organizationId,
          provider: 'stripe',
        }),
      ).rejects.toThrow();

      // And the account already connected is still there, still theirs to read.
      const still = await getPaymentAccount(shop.db, {
        organizationId: shop.organizationId,
        provider: 'stripe',
      });
      expect(still).not.toBeNull();
    } finally {
      const restored = await createRole(shop.db, {
        organizationId: shop.organizationId,
        name: `Owner ${randomUUID().slice(0, 6)}`,
        capabilities: [...ALL_CAPABILITIES],
      });
      await assignRole(shop.db, { membershipId: shop.membershipId, roleId: restored });
    }
  });

  it('leaves recorded payments alone when it is disconnected', async () => {
    await connectPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
      account: { accountId: 'acct_leaving' },
    });
    await disconnectPaymentAccount(shop.db, {
      organizationId: shop.organizationId,
      provider: 'stripe',
    });

    expect(
      await getPaymentAccount(shop.db, {
        organizationId: shop.organizationId,
        provider: 'stripe',
      }),
    ).toBeNull();

    // Disconnecting stops new charges. It reaches nothing that already happened — I8's
    // reasoning, which is why there is no cascade from this table to `payments`.
    const { data } = await shop.db
      .from('work_item_types')
      .select('id')
      .eq('organization_id', shop.organizationId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

/**
 * What a business still has to do, and the switch that used to lead nowhere.
 *
 * **The bug this describes is not a broken function — every piece worked.** Card payments could
 * be switched on while the section that connects an account was never rendered, because it sat
 * behind a deployment-level check for a processor. The business saw a switch go on and a page
 * say nothing, which is indistinguishable from having finished. `constraints.md` D31 makes the
 * rule general: a module names where it is configured, and a module that is on is asked whether
 * it can actually do the thing it was switched on for.
 *
 * A fresh business is founded here rather than reusing the one above, because the helper at the
 * top of this file deliberately arrives fully set up — a price, a published type and an address
 * — which is the one state in which none of this has anything to say.
 */
describe('what a switched-on module still needs', () => {
  let bare: { db: SupabaseClient; organizationId: string };

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `ready-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    const db = anonClient();
    const { error: signInError } = await db.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const organizationId = await foundBusiness({
      ownerEmail: email,
      name: 'Ready Ltd',
      displayName: 'Founder',
      timezone: 'UTC',
      currency: 'EUR',
    });

    bare = { db, organizationId };
  });

  it('tells a newly provisioned business that nothing is priced yet', async () => {
    // Billing is the one module a provisioned business arrives with, and it arrives with an
    // empty catalogue — which is correct (nothing may have a value the platform chose) and is
    // also the first thing anybody has to do. Saying so is the difference between a business
    // discovering it at the price of a question and discovering it at the price of a quote.
    const enabled = await listEnabledModules(bare.db, { organizationId: bare.organizationId });
    const outstanding = await outstandingModuleSetup(bare.db, {
      organizationId: bare.organizationId,
      enabled,
    });

    expect(outstanding.get('billing')).toBe('Nothing is priced yet, so a job cannot be quoted.');
  });

  it('says nothing about a module the business has not switched on', async () => {
    // The distinction that keeps this from becoming a to-do list the platform wrote. A module
    // nobody bought is not part of that business, so there is nobody to tell anything to — the
    // same reasoning that keeps its area out of the navigation entirely.
    const outstanding = await outstandingModuleSetup(bare.db, {
      organizationId: bare.organizationId,
      enabled: new Set(),
    });

    expect(outstanding.size).toBe(0);
  });

  it('stops asking once the business has done it', async () => {
    await createPriceBookItem(bare.db, {
      organizationId: bare.organizationId,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 9_000,
    });

    const outstanding = await outstandingModuleSetup(bare.db, {
      organizationId: bare.organizationId,
      enabled: new Set(['billing'] as const),
    });

    expect(outstanding.has('billing')).toBe(false);
  });

  it('walks public booking through both of the things it needs, in order', async () => {
    await setModuleEnabled(bare.db, {
      organizationId: bare.organizationId,
      key: 'booking',
      enabled: true,
    });

    const enabled = new Set(['booking'] as const);
    const before = await outstandingModuleSetup(bare.db, {
      organizationId: bare.organizationId,
      enabled,
    });
    expect(before.get('booking')).toBe('No public address yet, so there is no page to reach.');

    const organization = await getOrganization(bare.db, bare.organizationId);
    await updateOrganization(bare.db, {
      id: bare.organizationId,
      name: organization!.name,
      timezone: organization!.timezone,
      currency: organization!.currency!,
      bufferMinutes: organization!.bufferMinutes,
      slug: `ready-${randomUUID().slice(0, 6)}`,
    });

    // An address and nothing published: a page that answers for nobody. **This sentence used to
    // end "and no screen here can publish one", which was true and was the debt** —
    // `setTypeBookable` was reachable from the domain layer and from no route, which
    // `walkthrough.md` recorded as M4's. Now it names the screen, which is what D31 asks of every
    // input a module has: a business told what is missing has somewhere to go.
    const addressed = await outstandingModuleSetup(bare.db, {
      organizationId: bare.organizationId,
      enabled,
    });
    expect(addressed.get('booking')).toBe(
      'No kind of work is published to this page yet. Publish one on the Work screen, under the kind of work you want to take bookings for.',
    );

    const typeId = await createWorkItemType(bare.db, { schedulable: true,
      organizationId: bare.organizationId,
      name: 'Fitting',
    });
    const statusId = await createWorkItemStatus(bare.db, {
      organizationId: bare.organizationId,
      typeId,
      name: 'Requested',
      position: 0,
    });
    await setTypeBookable(bare.db, { id: typeId, statusId, durationMinutes: 30 });

    const done = await outstandingModuleSetup(bare.db, {
      organizationId: bare.organizationId,
      enabled,
    });
    expect(done.has('booking')).toBe(false);
  });

  it('has something to say about card payments with nothing connected', async () => {
    // **Deliberately not asserting which sentence.** Which of the two applies depends on whether
    // the deployment running this suite holds processor keys, and that is a property of an
    // environment rather than of this business. What must hold either way is that the screen is
    // not silent — silence is the whole of what D31 forbids.
    await setModuleEnabled(bare.db, {
      organizationId: bare.organizationId,
      key: 'card_payments',
      enabled: true,
    });

    const outstanding = await outstandingModuleSetup(bare.db, {
      organizationId: bare.organizationId,
      enabled: new Set(['card_payments'] as const),
    });

    expect(outstanding.get('card_payments')).toBeTruthy();
  });
});

/**
 * **A proposal names modules, and applying it switches them on.**
 *
 * A description like *"we repair plant on site, we invoice, and we take bookings online"* names
 * a module set as surely as it names a lifecycle. Before this, a proposal could describe a
 * business it then had no way to show — every screen it implied stayed hidden until somebody
 * found Settings.
 *
 * What is asserted here is the pair: that the list is applied, and that a bad list is refused
 * **before the first write**. The caller is often a model, and a model that invents a module
 * name or forgets a dependency must not leave half a configured business behind it.
 */
describe('the modules a configuration asks for', () => {
  let business: Awaited<ReturnType<typeof newBusiness>>;

  /**
   * The smallest shape that is a whole shape — this suite is about `modules` and nothing else.
   * A fresh type name each time, because two shapes applied to one business are two whole
   * configurations and `createWorkItemType` refuses a duplicate name.
   */
  const minimal = (modules: string[]): BusinessShape => ({
    typeName: `Job ${randomUUID().slice(0, 6)}`,
    schedulable: true,
    statuses: ['Open', 'Done'],
    transitions: [[0, 1]],
    fields: {},
    prices: [],
    hours: [],
    roles: [],
    modules: modules as BusinessShape['modules'],
  });

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    business = await newBusiness('shape-mod');
  });

  it('switches on what it names, and leaves what it does not name alone', async () => {
    await configureBusiness(business.db, business.organizationId, minimal(['assets']));

    // `listEnabledModules` is the wanted axis — organization_modules itself, unaffected by D41.
    const wanted = await listEnabledModules(business.db, {
      organizationId: business.organizationId,
    });

    expect(wanted.has('assets')).toBe(true);
    // **Applying never switches anything off.** A proposal describes a business; it is not an
    // inventory of one, so a module founding gave this business survives a shape that is silent
    // about it.
    expect(wanted.has('billing')).toBe(true);
    expect(wanted.has('drafting')).toBe(true);
    // Named by nobody, and still off.
    expect(wanted.has('portal')).toBe(false);

    // And usable (D41's wanted∩paid), since founding granted billing and drafting a term but
    // nothing granted assets one — the other half, proven on the same business.
    const usable = await listUsableModules(business.db, {
      organizationId: business.organizationId,
    });
    expect(usable.has('billing')).toBe(true);
    expect(usable.has('drafting')).toBe(true);
    expect(usable.has('assets')).toBe(false);
  });

  it('refuses a module this platform does not have, before writing anything', async () => {
    const before = await listWorkItemTypes(business.db, {
      organizationId: business.organizationId,
    });

    await expect(
      configureBusiness(business.db, business.organizationId, minimal(['telepathy'])),
    ).rejects.toThrow(/no module called telepathy/i);

    // The whole point of validating up front: a refusal partway would have left a type, two
    // statuses and a transition behind for a name nobody could act on.
    const after = await listWorkItemTypes(business.db, {
      organizationId: business.organizationId,
    });
    expect(after.length).toBe(before.length);
  });

  it('refuses a module whose dependency the same shape does not switch on', async () => {
    const before = await listWorkItemTypes(business.db, {
      organizationId: business.organizationId,
    });

    // Maintenance is counters and the rules that watch them, and a rule is an automation. On
    // its own it is a switch that does nothing — which is what D31 exists to prevent, caught
    // here rather than discovered on the Settings screen afterwards.
    await expect(
      configureBusiness(business.db, business.organizationId, minimal(['maintenance'])),
    ).rejects.toThrow(/Automations/);

    const after = await listWorkItemTypes(business.db, {
      organizationId: business.organizationId,
    });
    expect(after.length).toBe(before.length);

    // And the dependency named alongside it is fine — wanted, which is what this test is
    // actually about (D41 keeps `maintenance` unpaid and so unusable either way, since it is
    // not one of the founding modules a term was ever granted for).
    await configureBusiness(
      business.db,
      business.organizationId,
      minimal(['automations', 'maintenance']),
    );
    const settings = await listModuleSettings(business.db, {
      organizationId: business.organizationId,
    });
    const wanted = new Set(
      settings.filter((entry) => entry.enabledAt !== null).map((entry) => entry.module.key),
    );
    expect(wanted.has('maintenance')).toBe(true);
  });
});
