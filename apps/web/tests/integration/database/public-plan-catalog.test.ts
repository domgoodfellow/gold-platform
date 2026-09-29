import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { publicPlanCatalog } from '@/lib/domain/catalogue/public-catalog';

/**
 * F1's public-safe package projection (`public.public_plan_catalog()`).
 *
 * `platform_plans` and its siblings are classified COMMERCIAL in `catalogue-visibility.test.ts` --
 * readable only by a member or staff, never a signed-out caller. This function is the one
 * deliberate hole in that wall: a `security definer` read curated down to name/description/price/
 * products/quotas, so a public Pricing page can exist without granting `anon` a policy on the raw
 * tables. The claim worth testing is that hole is exactly as wide as intended: a signed-out caller
 * gets a real answer, the archived legacy Plans and any non-billable/unlisted Plan never appear,
 * Enterprise's absent price reads as "contact sales" rather than "free" or "hidden", and nothing
 * the row shape doesn't name (cost, margin, provider identifiers) is reachable through it.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

function signedOut(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

describe('the public plan catalog projection', () => {
  let visitor: SupabaseClient;

  beforeAll(() => {
    if (!ANON_KEY) throw new Error('SUPABASE_ANON_KEY must be set.');
    visitor = signedOut();
  });

  it('answers for a signed-out caller, who cannot read the underlying tables directly', async () => {
    // platform_plans has no grant to `anon` at all (only `authenticated`) — a signed-out caller
    // is refused outright, not merely filtered to zero rows by RLS.
    const { error: directError } = await visitor.from('platform_plans').select('id').limit(1);
    expect(directError).toMatchObject({ code: '42501' });

    const plans = await publicPlanCatalog(visitor as never);
    expect(plans.length).toBeGreaterThan(0);
  });

  it('lists Start, Operate and Scale with an approved CAD price, and excludes the archived launch snapshot', async () => {
    const plans = await publicPlanCatalog(visitor as never);
    const byKey = new Map(plans.map((p) => [p.key, p]));

    for (const key of ['start', 'operate', 'scale'] as const) {
      const plan = byKey.get(key);
      expect(plan, `${key} missing from the public projection`).toBeTruthy();
      expect(plan!.requiresContactSales).toBe(false);
      expect(plan!.prices).toEqual(
        expect.arrayContaining([expect.objectContaining({ currency: 'CAD', billingInterval: 'month' })]),
      );
      expect(plan!.products.length).toBeGreaterThan(0);
    }

    // The retired financial-model snapshot and GildOps' own non-billable dogfood Plan must never
    // reach a public caller, archived or not, billable or not.
    for (const retired of ['platform', 'sales_os_founding', 'sales_os', 'operations_os', 'business_managed', 'gold_internal']) {
      expect(byKey.has(retired), `${retired} leaked into the public projection`).toBe(false);
    }
  });

  it('represents Enterprise as contact-sales rather than free or hidden', async () => {
    const plans = await publicPlanCatalog(visitor as never);
    const enterprise = plans.find((p) => p.key === 'enterprise');
    expect(enterprise).toBeTruthy();
    expect(enterprise!.requiresContactSales).toBe(true);
    expect(enterprise!.prices).toEqual([]);
    // Still a real, granted package — contact-sales is a pricing fact, not an entitlement gap.
    expect(enterprise!.products.length).toBeGreaterThan(0);
  });

  it('exposes only the whitelisted shape — no cost, margin or provider column can ride along', async () => {
    const { data, error } = await visitor.rpc('public_plan_catalog');
    expect(error).toBeNull();
    const row = (data ?? [])[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(
      ['description', 'kind', 'label', 'plan_key', 'prices', 'products', 'quotas', 'requires_contact_sales'].sort(),
    );

    // Neither table has ever granted `anon` (or `authenticated`, for provider rates) any
    // privilege — the projection did not have to widen either grant to exist.
    const { error: costError } = await visitor.from('platform_provider_rates').select('id').limit(1);
    expect(costError).toMatchObject({ code: '42501' });

    const { error: assumptionsError } = await visitor.from('platform_plan_cost_assumptions').select('id').limit(1);
    expect(assumptionsError).toMatchObject({ code: '42501' });
  });
});
