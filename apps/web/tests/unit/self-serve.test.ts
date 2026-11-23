import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));

const { parseChosenPlan } = await import('@/lib/route/chosen-plan');
const { selfServeCurrencies, selfServePrice } = await import('@/lib/domain/platform-billing/self-serve');
const { planIncludesOffering } = await import('@/lib/marketing/content');

const plan = {
  prices: [
    { currency: 'CAD', amountMinor: 4_900, billingInterval: 'month' as const },
    { currency: 'CAD', amountMinor: 49_000, billingInterval: 'year' as const },
    { currency: 'USD', amountMinor: 3_900, billingInterval: 'month' as const },
  ],
};

describe('a plan chosen on Pricing', () => {
  it('keeps only a plan key of the catalogue’s shape, and bills monthly unless yearly was chosen', () => {
    expect(parseChosenPlan('start', 'year')).toEqual({ planKey: 'start', billingInterval: 'year' });
    expect(parseChosenPlan('start', 'weekly')).toEqual({ planKey: 'start', billingInterval: 'month' });
    expect(parseChosenPlan('start', null)).toEqual({ planKey: 'start', billingInterval: 'month' });
    for (const key of ['', 'Start', '1start', 'start;drop', '../x', 'a'.repeat(80), null, 42]) {
      expect(parseChosenPlan(key, 'month')).toBeNull();
    }
  });

  it('is sold only at a list price in the business’s currency and interval', () => {
    expect(selfServePrice(plan, 'CAD', 'month')?.amountMinor).toBe(4_900);
    expect(selfServePrice(plan, 'CAD', 'year')?.amountMinor).toBe(49_000);
    expect(selfServePrice(plan, 'USD', 'year')).toBeNull();
    expect(selfServePrice(plan, 'EUR', 'month')).toBeNull();
    expect(selfServePrice(plan, null, 'month')).toBeNull();
    expect(selfServeCurrencies(plan, 'month')).toEqual(['CAD', 'USD']);
    expect(selfServeCurrencies(plan, 'year')).toEqual(['CAD']);
  });
});

describe('a product page’s plans', () => {
  it('are the plans that include every catalogue product the product depends on', () => {
    const offering = { catalogue: ['comms.voice.browser_dialer', 'sales.pipeline.deals'] };
    expect(planIncludesOffering({ products: [{ key: 'comms' }, { key: 'sales' }, { key: 'finance' }] }, offering)).toBe(true);
    expect(planIncludesOffering({ products: [{ key: 'comms' }] }, offering)).toBe(false);
  });
});
