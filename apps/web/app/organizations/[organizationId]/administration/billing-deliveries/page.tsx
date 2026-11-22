import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import { listRecentPlatformBillingEvents } from '@/lib/domain/platform-billing/webhook-events';
import { listTenantsByIds } from '@/lib/domain/platform/tenants';
import { platformAncestry } from '@/lib/platform-navigation';
import { platformParams, requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

const APPLICATION_LABEL: Record<string, string> = {
  applied: 'Applied',
  stale: 'Older than state held',
  ambiguous: 'Conflicting, not applied',
};

/**
 * Administration → Reliability → Billing deliveries: whether the billing provider's webhook
 * deliveries arrive and are applied. Delivery health only — event, time and outcome, no amounts.
 * What each business subscribes to and pays is GildOps' Finance → Subscriptions.
 */
export default async function BillingDeliveriesPage({ params }: PageProps<'/organizations/[organizationId]/administration/billing-deliveries'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.health');
  const db = await getDb();
  const events = await listRecentPlatformBillingEvents(db, { limit: 50 });
  const tenants = await listTenantsByIds(db, [...new Set(events.flatMap((event) => (event.organizationId ? [event.organizationId] : [])))]);
  const nameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const environment = platformBillingEnvironment();

  return (
    <AppPage>
      <PageHeader title="Billing deliveries" crumbs={platformAncestry(goldId, 'billing-deliveries')} />
      <Hint className="mb-4">{environment ? `Environment: ${environment}` : 'No billing service is set up here.'}</Hint>
      <DataTable
        rows={events}
        rowKey={(event) => event.id}
        empty="Nothing received yet."
        columns={[
          { key: 'type', header: 'Event', emphasis: 'primary', cell: (event) => <span className="font-mono text-xs">{event.eventType}</span> },
          { key: 'business', header: 'Business', cell: (event) => (event.organizationId ? (nameById.get(event.organizationId) ?? event.organizationId) : '—') },
          { key: 'outcome', header: 'Outcome', cell: (event) => (event.application ? <Badge tone={event.application === 'applied' ? 'success' : 'neutral'}>{APPLICATION_LABEL[event.application]}</Badge> : 'Notice') },
          { key: 'provider', header: 'Sent', visibility: 'card-only', cell: (event) => (event.providerEventAt ? new Date(event.providerEventAt).toLocaleString() : '—') },
          { key: 'received', header: 'Received', cell: (event) => new Date(event.receivedAt).toLocaleString() },
          { key: 'environment', header: 'Environment', visibility: 'card-only', cell: (event) => event.environment },
        ]}
      />
    </AppPage>
  );
}
