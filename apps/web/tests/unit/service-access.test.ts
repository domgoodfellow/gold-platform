import { describe, expect, it } from 'vitest';
import {
  describeServiceAccess,
  resolveServiceAccess,
  SERVICEABLE_SUBSCRIPTION_STATUS,
  type ServiceAccessFacts,
} from '@/lib/domain/platform-billing/service-access';

/**
 * The commercial service-access policy, as a table. Pure: no database, no Stripe. A later grace
 * period for `past_due` changes one entry in `SERVICEABLE_SUBSCRIPTION_STATUS` and one row here.
 */

const BILLABLE = { key: 'standard', billable: true };
/** The facts every row below shares: a business that is already live. Setup has its own table. */
const live = (facts: Omit<ServiceAccessFacts, 'operationalState'>) =>
  resolveServiceAccess({ ...facts, operationalState: 'live' });
const setup = (facts: Omit<ServiceAccessFacts, 'operationalState'>) =>
  resolveServiceAccess({ ...facts, operationalState: 'setup' });
const sub = (
  status: ServiceAccessFacts['subscriptions'][number]['status'],
  environment: 'sandbox' | 'live' = 'sandbox',
) => ({ status, environment });

describe('who may use GOLD', () => {
  it.each([
    ['active', true],
    ['trialing', true],
    ['past_due', false],
    ['unpaid', false],
    ['canceled', false],
    ['incomplete', false],
    ['incomplete_expired', false],
    ['paused', false],
  ] as const)('a billable Plan with a %s subscription: permitted=%s', (status, permitted) => {
    const access = live({ plan: BILLABLE, subscriptions: [sub(status)], environment: 'sandbox' });
    expect(access.permitted).toBe(permitted);
    expect(access.subscriptionStatus).toBe(status);
    expect(access.code).toBe(permitted ? 'subscription_serviceable' : 'subscription_not_serviceable');
  });

  it('maps every status the subscription table admits', () => {
    expect(Object.keys(SERVICEABLE_SUBSCRIPTION_STATUS).sort()).toEqual([
      'active',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'past_due',
      'paused',
      'trialing',
      'unpaid',
    ]);
  });

  it('locks a billable Plan with no subscription at all', () => {
    const access = live({ plan: BILLABLE, subscriptions: [], environment: 'sandbox' });
    expect(access).toMatchObject({ permitted: false, code: 'subscription_missing', subscriptionStatus: null });
  });

  it('lets a non-billable Plan (GOLD Internal) through with no subscription', () => {
    const access = live({
      plan: { key: 'gold_internal', billable: false },
      subscriptions: [],
      environment: 'sandbox',
    });
    expect(access).toMatchObject({ permitted: true, code: 'non_billable_plan', planKey: 'gold_internal' });
  });

  it('does not consult a subscription for a non-billable Plan, even a canceled one', () => {
    const access = live({
      plan: { key: 'gold_internal', billable: false },
      subscriptions: [sub('canceled')],
      environment: 'sandbox',
    });
    expect(access.permitted).toBe(true);
  });

  it('requires nothing of an organization with no current Plan', () => {
    const access = live({ plan: null, subscriptions: [], environment: 'sandbox' });
    expect(access).toMatchObject({ permitted: true, code: 'no_plan' });
  });

  it('counts only the environment this deployment bills in', () => {
    const facts = { plan: BILLABLE, subscriptions: [sub('active', 'live')] };
    expect(live({ ...facts, environment: 'sandbox' }).permitted).toBe(false);
    expect(live({ ...facts, environment: 'live' }).permitted).toBe(true);
  });

  it('counts every row when billing is unconfigured, since nothing else could have written one', () => {
    const access = live({ plan: BILLABLE, subscriptions: [sub('active', 'live')], environment: null });
    expect(access.permitted).toBe(true);
  });

  it('is permitted by any serviceable row when the environment holds more than one', () => {
    const access = live({
      plan: BILLABLE,
      subscriptions: [sub('canceled', 'sandbox'), sub('active', 'sandbox')],
      environment: 'sandbox',
    });
    expect(access.permitted).toBe(true);
  });

  it('gives each outcome one sentence, so the tenant and staff read the same words', () => {
    const sentences = [
      live({ plan: null, subscriptions: [], environment: null }),
      live({ plan: { key: 'x', billable: false }, subscriptions: [], environment: null }),
      live({ plan: BILLABLE, subscriptions: [sub('active')], environment: null }),
      live({ plan: BILLABLE, subscriptions: [], environment: null }),
      live({ plan: BILLABLE, subscriptions: [sub('past_due')], environment: null }),
    ].map(describeServiceAccess);
    expect(new Set(sentences).size).toBe(5);
    expect(sentences[4]).toContain('past due');
  });

});

describe('payment is mandatory at Launch, not at Setup', () => {
  it('opens Setup to a billable Plan that has never had a subscription', () => {
    const access = setup({ plan: BILLABLE, subscriptions: [], environment: 'sandbox' });
    expect(access).toMatchObject({ permitted: true, code: 'subscription_pending_setup', planKey: 'standard' });
  });

  it.each(['incomplete', 'incomplete_expired'] as const)(
    'treats a %s checkout as never having started: Setup stays open',
    (status) => {
      expect(setup({ plan: BILLABLE, subscriptions: [sub(status)], environment: 'sandbox' }).permitted).toBe(true);
    },
  );

  it('locks the same facts once the business is live', () => {
    expect(live({ plan: BILLABLE, subscriptions: [], environment: 'sandbox' })).toMatchObject({
      permitted: false,
      code: 'subscription_missing',
    });
  });

  it.each(['past_due', 'unpaid', 'canceled', 'paused'] as const)(
    'does not let Setup hide a lapse: a %s subscription locks even in Setup',
    (status) => {
      expect(setup({ plan: BILLABLE, subscriptions: [sub(status)], environment: 'sandbox' })).toMatchObject({
        permitted: false,
        code: 'subscription_not_serviceable',
      });
    },
  );

  it('does not let an abandoned checkout hide a lapse that sits beside it', () => {
    const access = setup({
      plan: BILLABLE,
      subscriptions: [sub('incomplete'), sub('canceled')],
      environment: 'sandbox',
    });
    expect(access.permitted).toBe(false);
  });

  it('ignores a subscription in another environment, so it cannot make Setup look lapsed', () => {
    const access = setup({ plan: BILLABLE, subscriptions: [sub('canceled', 'live')], environment: 'sandbox' });
    expect(access.code).toBe('subscription_pending_setup');
  });

  it('changes nothing for a non-billable Plan or no Plan, in either state', () => {
    for (const state of [setup, live]) {
      expect(state({ plan: null, subscriptions: [], environment: null }).code).toBe('no_plan');
      expect(state({ plan: { key: 'x', billable: false }, subscriptions: [], environment: null }).code).toBe(
        'non_billable_plan',
      );
    }
  });

  it('still lets a serviceable subscription through in Setup, as the subscription it is', () => {
    expect(setup({ plan: BILLABLE, subscriptions: [sub('active')], environment: 'sandbox' }).code).toBe(
      'subscription_serviceable',
    );
  });
});
