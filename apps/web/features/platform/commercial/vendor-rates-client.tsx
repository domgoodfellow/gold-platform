'use client';

import { useActionState } from 'react';
import { recordVendorRateAction, VENDOR_RATE_INITIAL } from '@/app/organizations/[organizationId]/platform/vendor-rates/actions';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, SelectInput, TextInput } from '@/components/controls/inputs';
import { DefinitionList, Detail } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { Meter, Provider, ProviderCostMeter, ProviderCostRate } from '@/lib/domain/commercial/catalogue';
import { formatMicrosMoney } from '@/lib/domain/commercial/economics';

export function AddVendorRate({
  providers,
  meters,
  costMeters,
}: {
  providers: Provider[];
  meters: Meter[];
  costMeters: ProviderCostMeter[];
}) {
  const [state, action, pending] = useActionState(recordVendorRateAction, VENDOR_RATE_INITIAL);
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button>Add rate</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Add rate</PageDrawerTitle></PageDrawerHeader>
        <form action={action} className="flex flex-col gap-4 px-4">
          <div className="grid gap-1"><FieldLabel htmlFor="vendor-provider">Provider</FieldLabel><SelectInput id="vendor-provider" name="providerKey" required><option value="">Choose provider</option>{providers.map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}</SelectInput></div>
          <div className="grid gap-1"><FieldLabel htmlFor="vendor-cost-meter">Cost meter</FieldLabel><SelectInput id="vendor-cost-meter" name="costMeterKey" required><option value="">Choose cost meter</option>{costMeters.map((meter) => <option key={meter.key} value={meter.key}>{meter.label}</option>)}</SelectInput></div>
          <div className="grid gap-1"><FieldLabel htmlFor="vendor-commercial-meter">Commercial meter</FieldLabel><SelectInput id="vendor-commercial-meter" name="commercialMeterId" required><option value="">Choose commercial meter</option>{meters.map((meter) => <option key={meter.id} value={meter.id}>{meter.description}</option>)}</SelectInput></div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="grid gap-1"><FieldLabel htmlFor="vendor-rate">Rate (micro-minor units)</FieldLabel><TextInput id="vendor-rate" name="unitAmountMicros" type="number" min="0" step="1" required /></div>
            <div className="grid gap-1"><FieldLabel htmlFor="vendor-currency">Currency</FieldLabel><TextInput id="vendor-currency" name="currency" defaultValue="USD" minLength={3} maxLength={3} required /></div>
          </div>
          <div className="grid gap-1"><FieldLabel htmlFor="vendor-effective">Effective from</FieldLabel><TextInput id="vendor-effective" name="effectiveFrom" type="datetime-local" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1"><FieldLabel htmlFor="vendor-region">Region</FieldLabel><TextInput id="vendor-region" name="region" placeholder="CA or Global" /></div>
            <div className="grid gap-1"><FieldLabel htmlFor="vendor-direction">Direction</FieldLabel><SelectInput id="vendor-direction" name="direction"><option value="">Any</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></SelectInput></div>
          </div>
          <div className="grid gap-1"><FieldLabel htmlFor="vendor-resource">Resource type</FieldLabel><TextInput id="vendor-resource" name="resourceType" /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="vendor-source">Source</FieldLabel><TextInput id="vendor-source" name="source" placeholder="Provider API, invoice, or verified rate card" required /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="vendor-note">Note</FieldLabel><TextInput id="vendor-note" name="note" /></div>
          <ErrorText>{state.error}</ErrorText>
          {state.recorded ? <p className="text-sm text-muted">Rate version recorded.</p> : null}
          <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Adding…' : 'Add rate'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function VendorRateDrawer({ rate, history, label }: { rate: ProviderCostRate; history: ProviderCostRate[]; label: string }) {
  return (
    <PageDrawer>
      <PageDrawerTrigger className="font-medium underline-offset-4 hover:underline">{label}</PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>{label}</PageDrawerTitle><p className="text-sm text-muted">{rate.providerKey}</p></PageDrawerHeader>
        <DefinitionList className="px-4">
          <Detail label="Region">{rate.region ?? 'Global'}</Detail>
          <Detail label="Rate">{formatMicrosMoney(rate.unitAmountMicros, rate.currency, 4)}</Detail>
          <Detail label="Effective">{new Date(rate.effectiveFrom).toLocaleDateString()} → {rate.effectiveTo ? new Date(rate.effectiveTo).toLocaleDateString() : 'current'}</Detail>
          <Detail label="Source">{rate.source}</Detail>
          <Detail label="Imported">{new Date(rate.importedAt).toLocaleString()}</Detail>
        </DefinitionList>
        <Section className="mx-4">
          <SectionHeading>History</SectionHeading>
          <div className="mt-3"><DataTable rows={history} rowKey={(item) => item.id} empty="No earlier versions." columns={[
            { key: 'effective', header: 'Effective', emphasis: 'primary', cell: (item) => new Date(item.effectiveFrom).toLocaleDateString() },
            { key: 'rate', header: 'Rate', numeric: true, cell: (item) => formatMicrosMoney(item.unitAmountMicros, item.currency, 4) },
            { key: 'source', header: 'Source', cell: (item) => item.source },
          ]} /></div>
        </Section>
      </PageDrawerContent>
    </PageDrawer>
  );
}
