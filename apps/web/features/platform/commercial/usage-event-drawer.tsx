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


const RETAIL_STATE_LABEL: Record<EconomicsEvent['retailState'], string> = {
  priced: 'Priced at the rate then in force',
  no_currency: 'Not priced — this business has not said what it trades in',
  no_rate: 'Not priced — no retail rate for this meter',
};

const ALLOWANCE_APPLICATION_LABEL: Record<EconomicsEvent['allowanceApplication'], string> = {
  included: 'wholly included',
  partly_included: 'partly included',
  overage: 'wholly additional',
  ungoverned: 'ungoverned',
};

const WINDOW_BASIS_LABEL: Record<string, string> = {
  subscription: 'the processor’s own billing period',
  assignment: 'the plan assignment’s anchor',
  calendar: 'the calendar',
  none: 'no reset',
};

/** What window the split was decided in, and which fact fixed it — never presented as one of the others. */
function allowanceWindow(event: EconomicsEvent): string | null {
  if (event.allowanceKey === null) return null;
  const basis = WINDOW_BASIS_LABEL[event.allowanceWindow.basis ?? ''] ?? 'an unknown period';
  const span =
    event.allowanceWindow.startsAt && event.allowanceWindow.endsAt
      ? `${new Date(event.allowanceWindow.startsAt).toLocaleDateString()} – ${new Date(event.allowanceWindow.endsAt).toLocaleDateString()}`
      : 'no window';
  return `${span} · ${basis} · ${ALLOWANCE_APPLICATION_LABEL[event.allowanceApplication]}`;
}

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
        </DefinitionList>

        {/*
          Two accounts, kept visibly apart. A customer's allowance, overage and retail charge and
          GildOps' provider components and COGS are independent economic interpretations of one
          reading (D43); blending them into a single "rate" is the thing this layout refuses to do.
        */}
        <Section className="mx-4">
          <SectionHeading>Customer economics</SectionHeading>
          <DefinitionList className="mt-3">
            <Detail label="Allowance">
              {event.allowanceKey === null ? 'No allowance governs this meter' : event.allowanceKey.replaceAll('_', ' ')}
            </Detail>
            <Detail label="Included">
              {event.allowanceKey === null
                ? null
                : `${formatUsage(event.includedQuantity ?? 0, meterUnit)} of ${formatUsage(event.allowanceIncludedTotal ?? 0, meterUnit)} in the window`}
            </Detail>
            <Detail label="Billable">
              {event.allowanceKey === null
                ? formatUsage(event.quantity, meterUnit)
                : formatUsage(event.overageQuantity ?? 0, meterUnit)}
            </Detail>
            <Detail label="Window">{allowanceWindow(event)}</Detail>
            <Detail label="Rating">{RETAIL_STATE_LABEL[event.retailState]}</Detail>
            <Detail label="Customer charge">
              {event.retailState !== 'priced'
                ? '—'
                : formatMicrosMoney(event.customerChargeMicros, event.customerCurrency, 4)}
            </Detail>
          </DefinitionList>
        </Section>

        <Section className="mx-4">
          <SectionHeading>GildOps economics</SectionHeading>
          <DefinitionList className="mt-3">
            <Detail label="Cost state">{event.costState === 'unknown' ? 'Cost unknown' : event.costState}</Detail>
            <Detail label="Known COGS">
              {formatMicrosMoney(event.knownCostMicros, event.reportingCurrency, 4)}
            </Detail>
          </DefinitionList>
        </Section>

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
