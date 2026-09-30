import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { DividedList, EmptyState, SectionHeading } from '@/components/surfaces/section';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { getDb } from '@/lib/db/server';
import { platformBillingEnvironment, platformBillingProvider } from '@/lib/adapters/platform-billing';
import { getOrganizationServiceAccess } from '@/lib/domain/platform-billing/service-access';
import { getTenant } from '@/lib/domain/platform/tenants';
import {
  listOrganizationsRequiringAttention,
  listOrganizationSubscriptions,
} from '@/lib/domain/platform-billing/subscriptions';
import { listRecentPlatformBillingEvents } from '@/lib/domain/platform-billing/webhook-events';

export const dynamic = 'force-dynamic';

/**
 * The minimum coherent slice for staff to see GOLD's own subscription book: which organizations
 * are subscribed, which need attention, and the most recent webhook deliveries this deployment
 * acted on. Managing what's sellable stays at Catalog → Plans (`platform_plans`,
 * `platform_plan_prices`) — this page is state, not configuration.
 */
export default async function PlatformBillingPage({ params }: PageProps<'/organizations/[organizationId]/platform/billing'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.commercial');
  const db = await getDb();
  const provider = await platformBillingProvider();

  const [subscriptions, attention, events] = await Promise.all([
    listOrganizationSubscriptions(db),
    listOrganizationsRequiringAttention(db),
    listRecentPlatformBillingEvents(db, { limit: 20 }),
  ]);

  const organizationIds = [...new Set(subscriptions.map((s) => s.organizationId))];
  const tenants = await Promise.all(organizationIds.map((id) => getTenant(db, id)));
  const nameById = new Map(organizationIds.map((id, i) => [id, tenants[i]?.name ?? id]));

  // One row per organization: the resolver the tenant's own guard runs, not a second reading of `status`.
  const environment = platformBillingEnvironment();
  const accessById = new Map(
    await Promise.all(
      organizationIds.map(
        async (id) => [id, await getOrganizationServiceAccess(db, { organizationId: id, environment })] as const,
      ),
    ),
  );

  const counts = {
    active: subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing').length,
    attention: attention.length,
    total: subscriptions.length,
  };

  return (
    <AppPage>
      <PageHeader
        title="Billing"
        crumbs={platformAncestry(goldId, 'billing')}
        description={
          <>
            GildOps&rsquo;s own subscription book. Plans and prices are managed at{' '}
            <Link href={`/organizations/${goldId}/finance/plans`} className="underline underline-offset-4">
              Finance → Plans
            </Link>
            .
          </>
        }
      />

      {!provider ? (
        <EmptyState className="mt-6">
          Billing is not configured for this deployment — no STRIPE_SECRET_KEY is set.
        </EmptyState>
      ) : (
        <Hint className="mt-2">Environment: {provider.environment}</Hint>
      )}

      <WidgetGrid className="mt-6">
        <Widget title="Active or trialing" value={counts.active} />
        <Widget title="Requiring attention" value={counts.attention} />
        <Widget title="Total subscriptions recorded" value={counts.total} />
      </WidgetGrid>

      <SectionHeading className="mt-8">Organizations requiring attention</SectionHeading>
      {attention.length === 0 ? (
        <EmptyState className="mt-2">Nothing past due or unpaid.</EmptyState>
      ) : (
        <DividedList className="mt-2">
          {attention.map((s) => (
            <li key={s.organizationId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <Link
                href={platformHref(goldId, `organizations/${s.organizationId}/commercial`)}
                className="font-medium underline underline-offset-4"
              >
                {nameById.get(s.organizationId) ?? s.organizationId}
              </Link>
              <Badge>{s.status.replace('_', ' ')}</Badge>
            </li>
          ))}
        </DividedList>
      )}

      <SectionHeading className="mt-8">Subscriptions</SectionHeading>
      <div className="mt-2">
        <DataTable
          rows={subscriptions}
          rowKey={(s) => `${s.organizationId}:${s.environment}`}
          empty="No organization has subscribed yet."
          columns={[
            {
              key: 'organization',
              header: 'Organization',
              emphasis: 'primary',
              cell: (s) => (
                <Link
                  href={platformHref(goldId, `organizations/${s.organizationId}/commercial`)}
                  className="underline underline-offset-4"
                >
                  {nameById.get(s.organizationId) ?? s.organizationId}
                </Link>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (s) => (
                <Badge tone={s.status === 'active' || s.status === 'trialing' ? 'success' : 'neutral'}>
                  {s.status.replace('_', ' ')}
                </Badge>
              ),
            },
            {
              key: 'access',
              header: 'Service access',
              cell: (s) => (
                <Badge tone={accessById.get(s.organizationId)?.permitted ? 'success' : 'neutral'}>
                  {accessById.get(s.organizationId)?.permitted ? 'Available' : 'Locked'}
                </Badge>
              ),
            },
            { key: 'environment', header: 'Environment', emphasis: 'secondary', cell: (s) => s.environment },
            {
              key: 'period',
              header: 'Current period ends',
              cell: (s) => (
                <>
                  {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '—'}
                  {s.cancelAtPeriodEnd ? ' (canceling)' : ''}
                </>
              ),
            },
          ]}
        />
      </div>

      <SectionHeading className="mt-8">Recent webhook deliveries</SectionHeading>
      {events.length === 0 ? (
        <EmptyState className="mt-2">Nothing received yet.</EmptyState>
      ) : (
        <DividedList className="mt-2">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-mono text-xs">{event.eventType}</span>
              <span className="text-muted">{nameById.get(event.organizationId ?? '') ?? event.organizationId ?? '—'}</span>
              <span className="text-xs text-muted">{new Date(event.receivedAt).toLocaleString()}</span>
            </li>
          ))}
        </DividedList>
      )}
    </AppPage>
  );
}
