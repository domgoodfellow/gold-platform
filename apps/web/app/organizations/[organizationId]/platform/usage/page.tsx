import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { UsageEventDrawer } from '@/features/platform/commercial/usage-event-drawer';
import { getDb } from '@/lib/db/server';
import { listMeters, listProviders } from '@/lib/domain/commercial/catalogue';
import {
  formatMicrosMoney,
  formatUsage,
  listCostComponents,
  listEconomicsEvents,
  type CostState,
} from '@/lib/domain/commercial/economics';
import { listTenants } from '@/lib/domain/platform/tenants';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

export default async function UsageEconomicsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/platform/usage'> & { searchParams: Search }) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.commercial');
  const query = await searchParams;
  const organizationId = one(query.organization);
  const meterId = one(query.meter);
  const providerKey = one(query.provider);
  const state = one(query.state);
  const from = one(query.from);
  const to = one(query.to);
  const db = await getDb();
  const [events, meters, providers, organizations] = await Promise.all([
    listEconomicsEvents(db, {
      organizationId: organizationId || undefined,
      meterId: meterId || undefined,
      providerKey: providerKey || undefined,
      costState: state ? (state as CostState) : undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    }),
    listMeters(db),
    listProviders(db),
    listTenants(db),
  ]);
  const componentEntries = await Promise.all(
    events.map(async (event) => [event.id, await listCostComponents(db, event.id)] as const),
  );
  const components = new Map(componentEntries);
  const tenantRows = organizations.tenants;
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const knownCost = events.reduce((sum, event) => sum + event.knownCostMicros, 0);
  const unknownCount = events.filter((event) => event.costState === 'unknown').length;
  const reportingCurrencies = new Set(events.map((event) => event.reportingCurrency).filter(Boolean));
  const filtersActive = Boolean(organizationId || meterId || providerKey || state || from || to);

  return (
    <AppPage>
      <PageHeader title="Usage & economics" crumbs={platformAncestry(goldId, 'usage-economics')} />
      <form className="flex flex-wrap gap-2" role="search">
        <TextInput type="date" name="from" defaultValue={from} aria-label="From date" size="small" />
        <TextInput type="date" name="to" defaultValue={to} aria-label="To date" size="small" />
        <SelectInput name="organization" defaultValue={organizationId} aria-label="Organization" size="small">
          <option value="">All organizations</option>
          {tenantRows.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
        </SelectInput>
        <SelectInput name="meter" defaultValue={meterId} aria-label="Meter" size="small">
          <option value="">All meters</option>
          {meters.map((meter) => <option key={meter.id} value={meter.id}>{meter.description}</option>)}
        </SelectInput>
        <SelectInput name="provider" defaultValue={providerKey} aria-label="Provider" size="small">
          <option value="">All providers</option>
          {providers.map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}
        </SelectInput>
        <SelectInput name="state" defaultValue={state} aria-label="Cost state" size="small">
          <option value="">All cost states</option>
          <option value="reconciled">Reconciled</option>
          <option value="estimated">Estimated</option>
          <option value="unknown">Unknown</option>
        </SelectInput>
        <Button type="submit" tone="secondary" size="small">Filter</Button>
        {filtersActive ? <ButtonLink href={platformHref(goldId, 'usage')} tone="text" size="small">Clear</ButtonLink> : null}
      </form>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Known COGS</dt><dd className="font-medium tabular-nums">{reportingCurrencies.size === 1 ? formatMicrosMoney(knownCost, [...reportingCurrencies][0] ?? null) : reportingCurrencies.size > 1 ? 'Mixed currencies' : '—'}</dd></div>
        <div><dt className="text-muted">Unknown cost</dt><dd className="font-medium tabular-nums">{unknownCount.toLocaleString()}</dd></div>
        <div><dt className="text-muted">Usage events</dt><dd className="font-medium tabular-nums">{events.length.toLocaleString()}</dd></div>
        <div><dt className="text-muted">Costed coverage</dt><dd className="font-medium tabular-nums">{events.length ? `${Math.round(((events.length - unknownCount) / events.length) * 100)}%` : '—'}</dd></div>
      </dl>

      <div className="mt-5">
        <DataTable
          rows={events}
          rowKey={(event) => event.id}
          empty="No usage for this period."
          columns={[
            { key: 'organization', header: 'Organization', emphasis: 'primary', cell: (event) => <UsageEventDrawer event={event} components={components.get(event.id) ?? []} meterUnit={meterById.get(event.meterId)?.unit ?? 'unit'} /> },
            { key: 'meter', header: 'Meter', cell: (event) => event.meterId.replaceAll('_', ' ') },
            { key: 'usage', header: 'Usage', numeric: true, cell: (event) => formatUsage(event.quantity, meterById.get(event.meterId)?.unit ?? 'unit') },
            { key: 'cost', header: 'Known cost', numeric: true, cell: (event) => event.costState === 'unknown' ? (event.knownCostMicros > 0 ? `${formatMicrosMoney(event.knownCostMicros, event.reportingCurrency)} + unknown` : '—') : formatMicrosMoney(event.knownCostMicros, event.reportingCurrency) },
            { key: 'status', header: 'Status', cell: (event) => event.costState === 'unknown' ? 'Cost unknown' : event.costState },
            { key: 'occurred', header: 'Occurred', emphasis: 'secondary', cell: (event) => new Date(event.occurredAt).toLocaleString() },
          ]}
        />
      </div>
    </AppPage>
  );
}
