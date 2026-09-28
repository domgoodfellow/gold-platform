import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { SectionHeading } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { Badge } from '@/components/display/data';
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
      <PageHeader title="Billing" crumbs={platformAncestry(goldId, 'billing')} description={<>GildOps’s own subscription book — organizations paying GildOps, never the other direction. Plans and prices are managed at{' '} <Link href={platformHref(goldId, 'catalog/plans')} className="underline underline-offset-4"> Catalog → Plans </Link> .</>} />

      {!provider ? (
        <p className="mt-6 rounded border border-border bg-secondary p-4 text-sm text-muted-foreground">
          Billing is not configured for this deployment — no STRIPE_SECRET_KEY is set.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Environment: {provider.environment}</p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded border border-border p-4">
          <p className="text-xs text-muted-foreground">Active or trialing</p>
          <p className="text-2xl font-medium">{counts.active}</p>
        </div>
        <div className="rounded border border-border p-4">
          <p className="text-xs text-muted-foreground">Requiring attention</p>
          <p className="text-2xl font-medium">{counts.attention}</p>
        </div>
        <div className="rounded border border-border p-4">
          <p className="text-xs text-muted-foreground">Total subscriptions recorded</p>
          <p className="text-2xl font-medium">{counts.total}</p>
        </div>
      </div>

      <SectionHeading className="mt-8">Organizations requiring attention</SectionHeading>
      {attention.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing past due or unpaid.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-border">
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
        </ul>
      )}

      <SectionHeading className="mt-8">Subscriptions</SectionHeading>
      {subscriptions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No organization has subscribed yet.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 font-medium">Organization</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Service access</th>
              <th className="py-2 pr-4 font-medium">Environment</th>
              <th className="py-2 font-medium">Current period ends</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((s) => (
              <tr key={`${s.organizationId}:${s.environment}`} className="border-b border-border/50">
                <td className="py-2 pr-4">
                  <Link
                    href={platformHref(goldId, `organizations/${s.organizationId}/commercial`)}
                    className="underline underline-offset-4"
                  >
                    {nameById.get(s.organizationId) ?? s.organizationId}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <Badge tone={s.status === 'active' || s.status === 'trialing' ? 'success' : 'neutral'}>
                    {s.status.replace('_', ' ')}
                  </Badge>
                </td>
                <td className="py-2 pr-4">
                  <Badge tone={accessById.get(s.organizationId)?.permitted ? 'success' : 'neutral'}>
                    {accessById.get(s.organizationId)?.permitted ? 'Available' : 'Locked'}
                  </Badge>
                </td>
                <td className="py-2 pr-4">{s.environment}</td>
                <td className="py-2">
                  {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '—'}
                  {s.cancelAtPeriodEnd ? ' (canceling)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <SectionHeading className="mt-8">Recent webhook deliveries</SectionHeading>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing received yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-border">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-mono text-xs">{event.eventType}</span>
              <span className="text-muted-foreground">{nameById.get(event.organizationId ?? '') ?? event.organizationId ?? '—'}</span>
              <span className="text-xs text-muted-foreground">{new Date(event.receivedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </AppPage>
  );
}
