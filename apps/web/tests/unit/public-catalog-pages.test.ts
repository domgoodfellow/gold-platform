import { describe, expect, it } from 'vitest';
import { publicPlanCatalog } from '@/lib/domain/catalogue/public-catalog';

/** A catalogue read must not lose plans to the API's cap on rows per answer. */

function row(n: number) {
  return {
    plan_key: `plan_${String(n).padStart(5, '0')}`,
    kind: 'plan',
    label: `Plan ${n}`,
    description: '',
    requires_contact_sales: false,
    prices: [],
    products: [],
    quotas: [],
  };
}

function catalogue(total: number, calls: [number, number][]) {
  const all = Array.from({ length: total }, (_, i) => row(i));
  return {
    rpc: () => ({
      range: async (from: number, to: number) => {
        calls.push([from, to]);
        return { data: all.slice(from, to + 1), error: null };
      },
    }),
  } as never;
}

describe('the public plan catalogue', () => {
  it('returns every plan when there are more than one page of them', async () => {
    const calls: [number, number][] = [];
    const plans = await publicPlanCatalog(catalogue(1230, calls));
    expect(plans).toHaveLength(1230);
    expect(plans[0]?.key).toBe('plan_00000');
    expect(plans.at(-1)?.key).toBe('plan_01229');
    expect(calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('stops after a short page, and needs only one call for a small catalogue', async () => {
    const calls: [number, number][] = [];
    expect(await publicPlanCatalog(catalogue(4, calls))).toHaveLength(4);
    expect(calls).toEqual([[0, 499]]);
  });

  it('stops cleanly when the last page is exactly full', async () => {
    const calls: [number, number][] = [];
    expect(await publicPlanCatalog(catalogue(1000, calls))).toHaveLength(1000);
    expect(calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('reports a database refusal instead of a partial list', async () => {
    const failing = { rpc: () => ({ range: async () => ({ data: null, error: { message: 'down' } }) }) } as never;
    await expect(publicPlanCatalog(failing)).rejects.toMatchObject({ code: 'public_catalog.plans_failed' });
  });
});
