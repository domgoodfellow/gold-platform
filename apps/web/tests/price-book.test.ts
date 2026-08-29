import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPriceBookItem,
  listPriceBookItems,
  updatePriceBookItem,
} from '@/lib/domain/pricing/price-book';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';

/**
 * The catalogue: what a business charges for, in its own money.
 *
 * Nothing here calculates a price, and that absence is the point — I4 says there is exactly
 * one price calculation, and it belongs with the lines that consume this. What this proves is
 * that the numbers are held correctly: integer minor units, currency snapshotted onto each
 * amount rather than joined from the organization (I10), and no cross-tenant reach (I2).
 *
 * The sharpest test is the currency one. `organizations.currency` is editable, so an amount
 * with no currency of its own would silently mean something different the day after a
 * business changed what it trades in — the same failure `work_item_costs` already avoids for
 * history, avoided here for configuration.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let alice: Tenant;
let bob: Tenant;
let yen: Tenant;

async function newTenant(label: string, currency = 'EUR'): Promise<Tenant> {
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

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: 'Founder',
    p_timezone: 'UTC',
    p_currency: currency,
  });
  if (error) throw error;

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

describe('the price book', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('pb-alice');
    bob = await newTenant('pb-bob');
    yen = await newTenant('pb-yen', 'JPY');
  });

  it('prices in integer minor units, in the tenant’s own currency', async () => {
    await createPriceBookItem(alice.db, {
      organizationId: alice.organizationId,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 4250,
    });

    const [item] = await listPriceBookItems(alice.db, {
      organizationId: alice.organizationId,
    });

    expect(item.unitAmountMinor).toBe(4250);
    expect(item.currency).toBe('EUR');
  });

  it('uses each tenant’s own currency, never a platform default', async () => {
    await createPriceBookItem(yen.db, {
      organizationId: yen.organizationId,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 4250,
    });

    const [item] = await listPriceBookItems(yen.db, { organizationId: yen.organizationId });

    // The same integer, a hundredfold different amount of money. Nothing in the platform
    // decided this — the organization did, at founding.
    expect(item.currency).toBe('JPY');
    expect(item.unitAmountMinor).toBe(4250);
  });

  it('lets two tenants price the same thing under the same name (I2)', async () => {
    // If price_book_items_org_name_unique had been written on (name) alone, the second of
    // these would fail with a bare 23505 and no two businesses could both sell a callout.
    const theirs = await createPriceBookItem(bob.db, {
      organizationId: bob.organizationId,
      name: 'Callout',
      unit: 'job',
      unitAmountMinor: 9900,
    });

    expect(theirs).toBeTypeOf('string');

    const mine = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    expect(mine.map((item) => item.unitAmountMinor)).not.toContain(9900);
  });

  it('refuses a second item with the same name in one tenant', async () => {
    await expect(
      createPriceBookItem(alice.db, {
        organizationId: alice.organizationId,
        // Case and surrounding space do not make it a different thing to sell.
        name: '  callout ',
        unit: 'visit',
        unitAmountMinor: 1,
      }),
    ).rejects.toMatchObject({ code: 'prices.name_taken' });
  });

  it('refuses a fractional or negative amount', async () => {
    await expect(
      createPriceBookItem(alice.db, {
        organizationId: alice.organizationId,
        name: 'Fractional',
        unit: 'hour',
        unitAmountMinor: 42.5,
      }),
    ).rejects.toMatchObject({ code: 'prices.amount_not_integer' });

    // Not arithmetic squeamishness: discounting is deferred in constraints.md until travel
    // cost modelling can bound it, and a negative line item is that feature by the back door.
    await expect(
      createPriceBookItem(alice.db, {
        organizationId: alice.organizationId,
        name: 'Negative',
        unit: 'hour',
        unitAmountMinor: -100,
      }),
    ).rejects.toMatchObject({ code: 'prices.amount_negative' });
  });

  it('allows a price of zero, because included-at-no-charge is a real thing to publish', async () => {
    const id = await createPriceBookItem(alice.db, {
      organizationId: alice.organizationId,
      name: 'First hour, included',
      unit: 'hour',
      unitAmountMinor: 0,
    });

    expect(id).toBeTypeOf('string');
  });

  it('does not reinterpret a priced item when the business changes currency (I8)', async () => {
    const before = await listPriceBookItems(alice.db, {
      organizationId: alice.organizationId,
    });
    const callout = before.find((item) => item.name === 'Callout')!;
    expect(callout.currency).toBe('EUR');

    await updateOrganization(alice.db, {
      id: alice.organizationId,
      name: 'pb-alice Ltd',
      timezone: 'UTC',
      currency: 'USD',
      bufferMinutes: 0,
      slug: null,
    });

    const after = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const stillCallout = after.find((item) => item.name === 'Callout')!;

    // Forty-two fifty in euro, and it stays forty-two fifty in euro. Had the currency been
    // joined from the organization at render, this row would now silently read as dollars.
    expect(stillCallout.currency).toBe('EUR');
    expect(stillCallout.unitAmountMinor).toBe(4250);
  });

  it('will not change an item’s currency, even as a raw update (I8)', async () => {
    const [item] = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });

    // The column grant, not the domain layer declining an argument. Changing this converts
    // nothing — it reinterprets an amount somebody already decided.
    const { error } = await alice.db
      .from('price_book_items')
      .update({ currency: 'USD' })
      .eq('id', item.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('re-prices without touching anything already recorded', async () => {
    const before = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const callout = before.find((item) => item.name === 'Callout')!;

    await updatePriceBookItem(alice.db, {
      id: callout.id,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 5500,
    });

    const after = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    expect(after.find((item) => item.name === 'Callout')!.unitAmountMinor).toBe(5500);
  });

  it('shows each tenant only its own catalogue', async () => {
    const mine = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const theirs = await listPriceBookItems(bob.db, { organizationId: bob.organizationId });

    expect(mine.length).toBeGreaterThan(0);
    expect(theirs).toHaveLength(1);

    // Naming the other tenant's id explicitly: RLS answers this, not the filter.
    const reach = await listPriceBookItems(alice.db, { organizationId: bob.organizationId });
    expect(reach).toHaveLength(0);
  });

  it('refuses pricing to a member without the capability (I12)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Prices',
      capabilities: ['role.manage', 'customer.create'],
    });
    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();
    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      createPriceBookItem(bob.db, {
        organizationId: bob.organizationId,
        name: 'Sneaky',
        unit: 'each',
        unitAmountMinor: 1,
      }),
    ).rejects.toMatchObject({ code: 'prices.forbidden' });

    const [existing] = await listPriceBookItems(bob.db, {
      organizationId: bob.organizationId,
    });
    await expect(
      updatePriceBookItem(bob.db, {
        id: existing.id,
        name: 'Sneaky',
        unit: 'job',
        unitAmountMinor: 1,
      }),
    ).rejects.toMatchObject({ code: 'prices.forbidden' });
  });

  it('records a priced item on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id, payload')
      .eq('organization_id', alice.organizationId)
      .eq('entity_type', 'price_book_item');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((row) => row.actor_id === alice.userId)).toBe(true);
    expect(data!.map((row) => row.action)).toContain('price_book_item.created');
  });
});
