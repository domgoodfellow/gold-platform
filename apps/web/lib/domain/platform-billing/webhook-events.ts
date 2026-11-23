import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';

/**
 * The platform-billing webhook's own idempotency ledger, read-only here: delivery health for
 * Administration → Reliability (`platform.health`) and the deliveries behind one business's
 * subscription in GildOps' Finance (`subscription.read`). Never a second source of truth for
 * subscription state, and it holds no amounts.
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
  application: 'applied' | 'stale' | 'ambiguous' | 'unmatched' | null;
};

export async function listRecentPlatformBillingEvents(
  db: Db,
  input: { limit?: number; organizationId?: string } = {},
): Promise<PlatformBillingWebhookEvent[]> {
  let query = db
    .from('platform_billing_webhook_events')
    .select('id, provider, event_type, environment, organization_id, received_at, provider_event_created_at, application')
    .order('received_at', { ascending: false })
    .limit(input.limit ?? 20);
  if (input.organizationId) query = query.eq('organization_id', input.organizationId);
  const { data, error } = await query;
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
