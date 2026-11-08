import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';

/**
 * The platform-billing webhook's own idempotency ledger, read-only here — a staff diagnostic
 * (Phase 19: "how to inspect webhook deliveries") alongside Stripe's own dashboard, never a
 * second source of truth for subscription state.
 */
export type PlatformBillingWebhookEvent = {
  id: string;
  provider: string;
  eventType: string;
  environment: 'sandbox' | 'live';
  organizationId: string | null;
  receivedAt: string;
  /** When the provider says it happened. Null for an invoice notice, which is not ordered. */
  providerEventAt: string | null;
  /** What GildOps did with it: changed state, was older than the state held, or could not be ordered. Null for a notice. */
  application: 'applied' | 'stale' | 'ambiguous' | null;
};

export async function listRecentPlatformBillingEvents(
  db: Db,
  input: { limit?: number } = {},
): Promise<PlatformBillingWebhookEvent[]> {
  const { data, error } = await db
    .from('platform_billing_webhook_events')
    .select('id, provider, event_type, environment, organization_id, received_at, provider_event_created_at, application')
    .order('received_at', { ascending: false })
    .limit(input.limit ?? 20);
  if (error) throw fromDatabaseError(error, 'platform_billing.events_list_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    environment: row.environment as 'sandbox' | 'live',
    organizationId: row.organization_id,
    receivedAt: row.received_at,
    providerEventAt: row.provider_event_created_at,
    application: row.application as PlatformBillingWebhookEvent['application'],
  }));
}
