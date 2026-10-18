import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listMeterUsageObservations, listMeters, listProviderRates, listRetailRates } from '@/lib/domain/commercial/catalogue';

export default async function MetersPage({ params }: PageProps<'/platform/catalog/meters'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const [meters, providerRates, retailRates, observations] = await Promise.all([listMeters(db), listProviderRates(db), listRetailRates(db), listMeterUsageObservations(db)]);
  // Which Plan allowances meter against each one — the catalogue's own answer, read rather than
  // restated here, so a meter with a quota over it cannot look unused.
  const { data: quotaRows } = await db.from('platform_plan_quotas').select('allowance_key, meter_id').not('meter_id', 'is', null);
  const allowanceKeysByMeter = new Map<string, Set<string>>();
  for (const row of quotaRows ?? []) {
    if (!row.meter_id) continue;
    allowanceKeysByMeter.set(row.meter_id, (allowanceKeysByMeter.get(row.meter_id) ?? new Set()).add(row.allowance_key));
  }
  return <AppPage><PageHeader title="Meters" crumbs={platformAncestry(goldId, 'meters')} /><div><DataTable rows={meters} rowKey={(meter) => meter.id} empty="No platform meters recorded." columns={[{ key: 'meter', header: 'Meter', emphasis: 'primary', cell: (meter) => <div><span className="font-medium">{meter.label}</span><span className="block text-xs text-muted-foreground">{meter.id}</span><span className="block max-w-md text-xs text-muted-foreground">{meter.description}</span></div> }, { key: 'unit', header: 'Unit', cell: (meter) => <div>{meter.unit}<span className="block text-xs text-muted-foreground">{meter.aggregation === 'high_water' ? 'highest reading' : 'accumulates'}</span></div> }, { key: 'recorded', header: 'Recorded by', cell: (meter) => meter.writer ? <span className="font-mono text-xs">{meter.writer}</span> : <Badge>Vocabulary only</Badge> }, { key: 'allowance', header: 'Allowance', cell: (meter) => { const keys = allowanceKeysByMeter.get(meter.id); return keys ? [...keys].join(', ') : <span className="text-muted-foreground">None</span>; } }, { key: 'providers', header: 'Provider costs', cell: (meter) => { const providers = new Set(providerRates.filter((rate) => rate.meterId === meter.id).map((rate) => rate.providerKey)); return providers.size ? `${providers.size} provider${providers.size === 1 ? '' : 's'}` : <Link href={platformHref(goldId, 'pricing')} className="underline underline-offset-4">Unpriced</Link>; } }, { key: 'retail', header: 'Retail price', cell: (meter) => retailRates.some((rate) => rate.meterId === meter.id) ? <Badge tone="success">priced</Badge> : <Badge>missing</Badge> }, { key: 'observed', header: 'Observed usage', cell: (meter) => observations.has(meter.id) ? `${observations.get(meter.id)} events` : 'Not observed' }]} /></div></AppPage>;
}
