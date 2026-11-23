import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));

const { parseChosenPlan } = await import('@/lib/route/chosen-plan');
const { planIncludesOffering } = await import('@/lib/marketing/content');

describe('a plan chosen on Pricing', () => {
  it('keeps only a plan key of the catalogue’s shape', () => {
    expect(parseChosenPlan('start')).toEqual({ planKey: 'start' });
    for (const key of ['', 'Start', '1start', 'start;drop', '../x', 'a'.repeat(80), null, 42, undefined]) {
      expect(parseChosenPlan(key)).toBeNull();
    }
  });
});

describe('a product page’s plans', () => {
  it('are the plans that include every catalogue product the product depends on', () => {
    const offering = { catalogue: ['comms.voice.browser_dialer', 'sales.pipeline.deals'] };
    expect(planIncludesOffering({ products: [{ key: 'comms' }, { key: 'sales' }, { key: 'finance' }] }, offering)).toBe(true);
    expect(planIncludesOffering({ products: [{ key: 'comms' }] }, offering)).toBe(false);
  });
});
