import { platformParams } from '@/lib/route/platform';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { DataTable } from '@/components/display/table';
import { UsageEventDrawer } from '@/features/platform/commercial/usage-event-drawer';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { getDb } from '@/lib/db/server';
import { listMeters } from '@/lib/domain/commercial/catalogue';
import { formatMicrosMoney, formatUsage, listCostComponents, listEconomicsEvents } from '@/lib/domain/commercial/economics';
import { getTenant } from '@/lib/domain/platform/tenants';
import { platformHref } from '@/lib/platform-navigation';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

export default async function TenantUsage({ params }: PageProps<'/platform/organizations/[targetOrganizationId]/usage'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const [tenant, events, meters] = await Promise.all([
    getTenant(db, organizationId), listEconomicsEvents(db, { organizationId }), listMeters(db),
  ]);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));
  const components = new Map(await Promise.all(events.map(async (event) => [event.id, await listCostComponents(db, event.id)] as const)));
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const grouped = new Map<string, { meterId: string; quantity: number; knownCost: number; currency: string | null; unknown: number }>();
  for (const event of events) {
    const current = grouped.get(event.meterId) ?? { meterId: event.meterId, quantity: 0, knownCost: 0, currency: event.reportingCurrency, unknown: 0 };
    current.quantity += event.quantity;
    current.knownCost += event.knownCostMicros;
    current.unknown += event.costState === 'unknown' ? 1 : 0;
    if (current.currency !== event.reportingCurrency) current.currency = null;
    grouped.set(event.meterId, current);
  }
  const summary = [...grouped.values()];
  const totalKnown = summary.reduce((sum, row) => sum + row.knownCost, 0);
  const currencies = new Set(summary.map((row) => row.currency).filter(Boolean));
  const unknown = summary.reduce((sum, row) => sum + row.unknown, 0);
  return <AppPage>
    <TenantWorkspaceHeader goldId={goldId} id={organizationId} name={tenant.name} currency={tenant.currency} />
    <dl className="mt-6 grid grid-cols-3 gap-x-6 border-y border-border py-3 text-sm">
      <div><dt className="text-muted">Known COGS</dt><dd className="font-medium tabular-nums">{currencies.size === 1 ? formatMicrosMoney(totalKnown, [...currencies][0] ?? null) : 'Mixed currencies'}</dd></div>
      <div><dt className="text-muted">Unknown cost events</dt><dd className="font-medium tabular-nums">{unknown.toLocaleString()}</dd></div>
      <div><dt className="text-muted">Usage events</dt><dd className="font-medium tabular-nums">{events.length.toLocaleString()}</dd></div>
    </dl>
    <section className="mt-6"><h2 className="text-base font-semibold">Usage by meter</h2><div className="mt-3"><DataTable rows={summary} rowKey={(row) => row.meterId} empty="No usage for this period." columns={[
      { key: 'meter', header: 'Meter', emphasis: 'primary', cell: (row) => row.meterId.replaceAll('_', ' ') },
      { key: 'quantity', header: 'Quantity', numeric: true, cell: (row) => formatUsage(row.quantity, meterById.get(row.meterId)?.unit ?? 'unit') },
      { key: 'state', header: 'Cost state', cell: (row) => row.unknown ? `${row.unknown} unknown` : 'Costed' },
      { key: 'cost', header: 'Known COGS', numeric: true, cell: (row) => formatMicrosMoney(row.knownCost, row.currency) },
    ]} /></div></section>
    <section className="mt-8"><h2 className="text-base font-semibold">Usage events</h2><div className="mt-3"><DataTable rows={events} rowKey={(event) => event.id} empty="No usage for this period." columns={[
      { key: 'source', header: 'Source', emphasis: 'primary', cell: (event) => <UsageEventDrawer event={event} components={components.get(event.id) ?? []} meterUnit={meterById.get(event.meterId)?.unit ?? 'unit'} /> },
      { key: 'meter', header: 'Meter', cell: (event) => event.meterId.replaceAll('_', ' ') },
      { key: 'usage', header: 'Usage', numeric: true, cell: (event) => formatUsage(event.quantity, meterById.get(event.meterId)?.unit ?? 'unit') },
      { key: 'cost', header: 'Known cost', numeric: true, cell: (event) => event.costState === 'unknown' ? (event.knownCostMicros > 0 ? `${formatMicrosMoney(event.knownCostMicros, event.reportingCurrency)} + unknown` : '—') : formatMicrosMoney(event.knownCostMicros, event.reportingCurrency) },
      { key: 'state', header: 'State', cell: (event) => event.costState === 'unknown' ? 'Cost unknown' : event.costState },
    ]} /></div></section>
  </AppPage>;
}
