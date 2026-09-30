'use client';

import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { DefinitionList, Detail } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { CostComponent, EconomicsEvent } from '@/lib/domain/commercial/economics';
import { formatMicrosMoney, formatUsage } from '@/lib/domain/commercial/economics';

export function UsageEventDrawer({
  event,
  components,
  meterUnit,
}: {
  event: EconomicsEvent;
  components: CostComponent[];
  meterUnit: string;
}) {
  return (
    <PageDrawer>
      <PageDrawerTrigger className="font-medium underline-offset-4 hover:underline">
        {event.organizationName}
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{event.meterId.replaceAll('_', ' ')}</PageDrawerTitle>
          <p className="text-sm text-muted">{event.organizationName}</p>
        </PageDrawerHeader>
        <DefinitionList className="px-4">
          <Detail label="Usage">{formatUsage(event.quantity, meterUnit)}</Detail>
          <Detail label="Occurred">{new Date(event.occurredAt).toLocaleString()}</Detail>
          <Detail label="Source">{event.sourceDomain.replaceAll('.', ' · ')}</Detail>
          <Detail label="Retail state">
            {event.customerChargeMicros === null
              ? 'Unpriced'
              : formatMicrosMoney(event.customerChargeMicros, event.customerCurrency)}
          </Detail>
          <Detail label="Cost state">{event.costState === 'unknown' ? 'Cost unknown' : event.costState}</Detail>
        </DefinitionList>
        <Section className="mx-4">
          <SectionHeading>Cost components</SectionHeading>
          <div className="mt-3">
            <DataTable
              rows={components}
              rowKey={(component) => component.id}
              empty="No provider cost components recorded."
              columns={[
                {
                  key: 'component',
                  header: 'Component',
                  emphasis: 'primary',
                  cell: (component) => (
                    <div>
                      <span className="font-medium">{component.key.replaceAll('_', ' ')}</span>
                      <span className="block text-xs text-muted">{component.providerKey}</span>
                    </div>
                  ),
                },
                {
                  key: 'quantity',
                  header: 'Quantity',
                  numeric: true,
                  cell: (component) => formatUsage(component.quantity, component.unit),
                },
                {
                  key: 'cost',
                  header: 'Native cost',
                  numeric: true,
                  cell: (component) =>
                    component.costState === 'unknown'
                      ? 'Cost unknown'
                      : formatMicrosMoney(component.nativeCostMicros, component.nativeCurrency, 4),
                },
                { key: 'state', header: 'State', cell: (component) => component.costState },
              ]}
            />
          </div>
          {components.some((component) => component.costState === 'unknown') ? (
            <div className="mt-4 border-l-2 border-danger/50 pl-3 text-sm">
              <p className="font-medium">Cost unknown</p>
              <p className="text-muted">
                {components.find((component) => component.costState === 'unknown')?.unknownReason ??
                  'A provider rate or FX rate is missing.'}
              </p>
            </div>
          ) : null}
        </Section>
      </PageDrawerContent>
    </PageDrawer>
  );
}
