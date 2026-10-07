import Link from 'next/link';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { KpiCard, type Kpi } from '@/components/surfaces/kpi-card';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { CreateCustomerTrigger } from '@/features/crm/customers/create-customer-sheet';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';

export type CrmHomeProps = {
  organizationId: string;
  timezone: string;
  customers: Customer[];
  totalCustomers: number;
  pipeline: { stages: (CustomerStage & { count: number })[]; unstaged: number } | null;
  stagesSettingsHref?: string;
  mayCreate: boolean;
  mayImport: boolean;
  mayConfigure: boolean;
  mayInsight: boolean;
  activity: ReactNode;
};

/** A launch surface over canonical CRM reads; collection, creation and configuration stay with their owners. */
export function CrmHome({
  organizationId, timezone, customers, totalCustomers, pipeline, stagesSettingsHref,
  mayCreate, mayImport, mayConfigure, mayInsight, activity,
}: CrmHomeProps) {
  const customersHref = areaHref(organizationId, 'customers');
  const pipelineHref = areaHref(organizationId, 'pipeline');
  const importHref = `/organizations/${organizationId}/integrations/imports/new`;
  const stageNames = new Map(pipeline?.stages.map((stage) => [stage.id, stage.name]) ?? []);
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timezone });
  const kpis: Kpi[] = [{ key: 'customers', label: areaLabel('customers'), value: totalCustomers, href: customersHref }];
  if (pipeline) kpis.push(
    { key: 'pipeline', label: 'In pipeline', value: totalCustomers - pipeline.unstaged, href: pipelineHref },
    { key: 'unstaged', label: 'Unstaged', value: pipeline.unstaged, href: `${customersHref}?stage=unstaged` },
  );

  return (
    <WorkspaceHome
      title={workspaceLabel('crm')}
      insights={mayInsight}
      configure={mayConfigure}
      actions={
        <>
          <form action={customersHref} method="get" role="search" className="flex min-w-0 gap-2">
            <TextInput type="search" name="q" aria-label="Search customers" placeholder="Search customers…" className="w-full sm:w-52" />
            <Button type="submit" tone="secondary" aria-label="Search"><Search aria-hidden /></Button>
          </form>
          {mayImport ? <ButtonLink href={importHref} tone="secondary">Import customers</ButtonLink> : null}
          {mayCreate ? <CreateCustomerTrigger /> : null}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
      </div>
      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <div className="min-w-0 space-y-6">
          <Section aria-labelledby="crm-pipeline-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionHeading id="crm-pipeline-heading">Pipeline snapshot</SectionHeading>
              {pipeline ? <ButtonLink href={pipelineHref} tone="text">View pipeline</ButtonLink> : null}
            </div>
            {!pipeline ? (
              <EmptyState>Pipeline is not available. Availability follows this organization’s enabled CRM features.</EmptyState>
            ) : pipeline.stages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">No sales stages configured</p>
                <p className="text-sm text-muted">Define the stages this business moves customer relationships through.</p>
                {stagesSettingsHref ? <ButtonLink href={stagesSettingsHref} tone="secondary">Configure sales stages</ButtonLink> : null}
              </div>
            ) : (
              <DividedList>
                {pipeline.stages.map((stage) => (
                  <li key={stage.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`${customersHref}?stage=${encodeURIComponent(stage.id)}`} className="underline-offset-4 hover:underline">{stage.name}</Link>
                    <span className="font-medium tabular-nums">{stage.count}</span>
                  </li>
                ))}
              </DividedList>
            )}
          </Section>
          <Section aria-labelledby="crm-customers-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionHeading id="crm-customers-heading">Recent customers</SectionHeading>
              <ButtonLink href={customersHref} tone="text">View all customers</ButtonLink>
            </div>
            {customers.length === 0 ? (
              <div className="space-y-3">
                <EmptyState>No customers have been added yet.</EmptyState>
                <div className="flex flex-wrap gap-2">
                  {mayCreate ? <CreateCustomerTrigger /> : null}
                  {mayImport ? <ButtonLink href={importHref} tone="secondary">Import customers</ButtonLink> : null}
                </div>
              </div>
            ) : (
              <DividedList>
                {customers.slice(0, 5).map((customer) => (
                  <li key={customer.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link className="font-medium underline underline-offset-4" href={`${customersHref}/${customer.id}`}>{customer.name}</Link>
                      {customer.email || customer.phone ? <p className="mt-1 break-words text-xs text-muted">{customer.email || customer.phone}</p> : null}
                    </div>
                    <div className="text-right text-xs text-muted">
                      {pipeline && pipeline.stages.length > 0 ? <p className="mb-1">{customer.stageId ? stageNames.get(customer.stageId) ?? 'Unknown stage' : 'Unstaged'}</p> : null}
                      <span className="sr-only">Date added: </span>
                      <time dateTime={customer.createdAt}>{date.format(new Date(customer.createdAt))}</time>
                    </div>
                  </li>
                ))}
              </DividedList>
            )}
          </Section>
        </div>
        <Section aria-labelledby="crm-activity-heading" className="min-w-0">
          <SectionHeading id="crm-activity-heading" className="mb-3">Recent CRM activity</SectionHeading>
          {activity}
        </Section>
      </div>
    </WorkspaceHome>
  );
}
