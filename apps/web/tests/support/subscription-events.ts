import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

/**
 * A provider subscription event delivered exactly as `apps/api` delivers it: through the one
 * database function `platform_billing_webhook` may execute. Shared by the suites that need a
 * subscription row to exist, so the function's argument shape lives in one place.
 */
export type TestSubscriptionItem = {
  itemReference?: string;
  priceReference: string;
  quantity?: number | null;
  periodStart?: number | null;
  periodEnd?: number | null;
};

export type TestSubscriptionEvent = {
  eventReference?: string;
  type?: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted';
  customerReference: string;
  subscriptionReference: string;
  status?: string;
  currency?: string;
  periodStart?: number | null;
  periodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: number | null;
  /** The provider's occurrence time, in seconds. Required: events are ordered by it. */
  createdAt: number;
  items: TestSubscriptionItem[];
  checkoutCorrelation?: string | null;
  /** The environment the signed event came from, as the webhook sends it. Null is a webhook that sends none. */
  environment?: 'sandbox' | 'live' | null;
};

export const APPLY_SUBSCRIPTION_SQL = `select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) as result`;

export function subscriptionEventArgs(event: TestSubscriptionEvent): unknown[] {
  return [
    event.eventReference ?? `evt_${randomUUID()}`,
    event.type ?? 'customer.subscription.updated',
    event.customerReference,
    event.subscriptionReference,
    event.status ?? 'active',
    event.currency ?? 'CAD',
    event.periodStart ?? null,
    event.periodEnd ?? null,
    event.cancelAtPeriodEnd ?? false,
    event.canceledAt ?? null,
    event.createdAt,
    JSON.stringify(
      event.items.map((item) => ({
        item_reference: item.itemReference ?? `si_${randomUUID().slice(0, 10)}`,
        price_reference: item.priceReference,
        quantity: item.quantity === undefined ? 1 : item.quantity,
        current_period_start: item.periodStart ?? null,
        current_period_end: item.periodEnd ?? null,
      })),
    ),
    event.checkoutCorrelation ?? null,
    'stripe',
    event.environment === undefined ? 'sandbox' : event.environment,
  ];
}

/** Returns the organization id the function acted on, or null when it applied nothing (unknown customer, repeat delivery). */
export async function applySubscriptionEvent(pg: Client, event: TestSubscriptionEvent): Promise<string | null> {
  const { rows } = await pg.query(APPLY_SUBSCRIPTION_SQL, subscriptionEventArgs(event));
  return rows[0].result;
}
