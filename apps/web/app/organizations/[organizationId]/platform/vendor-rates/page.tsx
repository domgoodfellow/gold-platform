import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { AddVendorRate, VendorRateDrawer } from '@/features/platform/commercial/vendor-rates-client';
import { getDb } from '@/lib/db/server';
import { listMeters, listProviderCostMeters, listProviderCostRates, listProviders } from '@/lib/domain/commercial/catalogue';
import { formatMicrosMoney } from '@/lib/domain/commercial/economics';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';
const scopesMatch = (left: Awaited<ReturnType<typeof listProviderCostRates>>[number], right: Awaited<ReturnType<typeof listProviderCostRates>>[number]) =>
  left.id !== right.id && left.providerKey === right.providerKey && left.costMeterKey === right.costMeterKey &&
  left.region === right.region && left.direction === right.direction && left.resourceType === right.resourceType;
const intervalsOverlap = (left: Awaited<ReturnType<typeof listProviderCostRates>>[number], right: Awaited<ReturnType<typeof listProviderCostRates>>[number]) =>
  (!left.effectiveTo || new Date(right.effectiveFrom) < new Date(left.effectiveTo)) &&
  (!right.effectiveTo || new Date(left.effectiveFrom) < new Date(right.effectiveTo));

export default async function VendorRatesPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/platform/vendor-rates'> & { searchParams: Search }) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.commercial');
  const query = await searchParams;
  const providerKey = one(query.provider);
  const costMeterKey = one(query.meter);
  const region = one(query.region);
  const currentOnly = one(query.current) !== 'all';
  const db = await getDb();
  const [rates, allRates, providers, costMeters, meters] = await Promise.all([
    listProviderCostRates(db, { providerKey: providerKey || undefined, costMeterKey: costMeterKey || undefined, region: region || undefined, currentOnly }),
    listProviderCostRates(db), listProviders(db), listProviderCostMeters(db), listMeters(db),
  ]);
  const providersByKey = new Map(providers.map((provider) => [provider.key, provider.label]));
  const costMetersByKey = new Map(costMeters.map((meter) => [meter.key, meter]));
  const filtered = rates.filter((rate) => !one(query.q) || `${rate.costMeterKey} ${rate.source}`.toLowerCase().includes(one(query.q).toLowerCase()));
  return (
    <AppPage>
      <PageHeader title="Vendor rates" crumbs={platformAncestry(goldId, 'vendor-rates')} actions={<AddVendorRate providers={providers} meters={meters} costMeters={costMeters} />} />
      <form className="flex flex-wrap gap-2" role="search">
        <TextInput name="q" defaultValue={one(query.q)} placeholder="Search rates" aria-label="Search rates" size="small" />
        <SelectInput name="provider" defaultValue={providerKey} aria-label="Provider" size="small"><option value="">All providers</option>{providers.map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}</SelectInput>
        <SelectInput name="meter" defaultValue={costMeterKey} aria-label="Service" size="small"><option value="">All services</option>{costMeters.map((meter) => <option key={meter.key} value={meter.key}>{meter.label}</option>)}</SelectInput>
        <TextInput name="region" defaultValue={region} placeholder="Country / region" aria-label="Country or region" size="small" className="w-36" />
        <SelectInput name="current" defaultValue={currentOnly ? 'current' : 'all'} aria-label="Effective state" size="small"><option value="current">Current only</option><option value="all">All history</option></SelectInput>
        <Button type="submit" tone="secondary" size="small">Filter</Button>
        {providerKey || costMeterKey || region || one(query.q) || !currentOnly ? <ButtonLink href={platformHref(goldId, 'vendor-rates')} tone="text" size="small">Clear</ButtonLink> : null}
      </form>
      <div className="mt-5">
        <DataTable rows={filtered} rowKey={(rate) => rate.id} empty="No rates imported yet." columns={[
          { key: 'provider', header: 'Provider', cell: (rate) => providersByKey.get(rate.providerKey ?? '') ?? rate.providerKey },
          { key: 'meter', header: 'Cost meter', emphasis: 'primary', cell: (rate) => <VendorRateDrawer rate={rate} history={allRates.filter((item) => item.providerKey === rate.providerKey && item.costMeterKey === rate.costMeterKey && item.region === rate.region)} label={costMetersByKey.get(rate.costMeterKey)?.label ?? rate.costMeterKey} /> },
          { key: 'region', header: 'Region', cell: (rate) => rate.region ?? 'Global' },
          { key: 'rate', header: 'Rate', numeric: true, cell: (rate) => `${formatMicrosMoney(rate.unitAmountMicros, rate.currency, 4)} / ${costMetersByKey.get(rate.costMeterKey)?.unit ?? 'unit'}` },
          { key: 'effective', header: 'Effective', cell: (rate) => new Date(rate.effectiveFrom).toLocaleDateString() },
          { key: 'attention', header: 'Status', cell: (rate) => allRates.some((item) => scopesMatch(rate, item) && intervalsOverlap(rate, item)) ? 'Needs attention' : 'OK' },
          { key: 'source', header: 'Source', emphasis: 'secondary', cell: (rate) => rate.source },
        ]} />
      </div>
    </AppPage>
  );
}
