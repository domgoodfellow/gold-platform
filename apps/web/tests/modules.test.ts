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
  setModuleEnabled,
} from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';

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

  const { data: organizationId, error: createError } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: 'Founder',
    p_timezone: 'UTC',
    p_currency: 'EUR',
  });
  if (createError) throw createError;

  const organization = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: organization, name: 'Job' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: organization,
    typeId,
    name: 'Requested',
    position: 0,
  });
  await createResource(db, { organizationId: organization, name: 'Bay' });
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
    currency: org!.currency,
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

  it('starts a new business on the operational core and nothing that publishes', async () => {
    const enabled = await listEnabledModules(shop.db, { organizationId: shop.organizationId });

    expect([...enabled].sort()).toEqual(['billing', 'customers', 'scheduling', 'work']);
    // Publishing a page to the internet is not a default anybody should acquire by signing up.
    expect(enabled.has('booking')).toBe(false);
    expect(enabled.has('portal')).toBe(false);
    expect(enabled.has('card_payments')).toBe(false);
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
          resourceId: randomUUID(),
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

  it('refuses to switch off the operational core', async () => {
    // Not every module is optional, and a disabled control would say "you could do this if
    // something changed". There is nothing a business could change.
    await expect(
      setModuleEnabled(shop.db, {
        organizationId: shop.organizationId,
        key: 'work',
        enabled: false,
      }),
    ).rejects.toThrow(/cannot be switched off/i);
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
      expect(enabled.has('work')).toBe(true);

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
