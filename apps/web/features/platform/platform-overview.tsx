import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { SectionHeading } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Widget, WidgetGrid } from '@/components/display/widget';
import type { PlatformOverview as PlatformOverviewData } from '@/lib/domain/platform/overview';

/**
 * `/platform`'s landing screen. An area dashboard in the `ui-spec.md` §2b sense — the same
 * `Widget`/`WidgetGrid` vocabulary Today uses, not the tenant-configured `dashboards` in
 * `lib/domain/reporting/`. Four numbers and one table, all read straight off `PlatformOverview`
 * (`lib/domain/platform/overview.ts`) with no arithmetic performed here — see
 * `docs/constraints.md`'s "Decided, not yet built" table for what was deliberately left off this
 * screen and why.
 */
export function PlatformOverview({ organizations, failures, catalogue, rates }: PlatformOverviewData) {
  const totalFailures = failures.operational + failures.providerReconciliation;

  return (
    <AppPage width="full">
      <PageHeader title="Overview" />
      <Hint className="block">The state of every business running on GOLD.</Hint>

      <WidgetGrid className="mt-6">
        <Widget
          title="Organizations"
          value={organizations.total}
          note={organizations.total === 0 ? undefined : `${organizations.live} live · ${organizations.settingUp} setting up`}
          href="/platform/organizations"
        />
        <Widget
          title="Attention"
          value={totalFailures}
          note={totalFailures === 0 ? 'Nothing needs attention.' : `${failures.operational} operational · ${failures.providerReconciliation} provider reconciliation`}
          href="/platform/failures"
        />
        <Widget
          title="Catalog"
          value={catalogue.products}
          note={`Sellable products · ${catalogue.meters} meter${catalogue.meters === 1 ? '' : 's'} defined`}
          href="/platform/catalog/products"
        />
        <Widget
          title="Rate cards"
          value={rates.retail}
          note={`Retail rates recorded · ${rates.provider} provider rate${rates.provider === 1 ? '' : 's'}`}
          href="/platform/pricing"
        />
      </WidgetGrid>

      <section className="mt-8">
        <SectionHeading>Recently provisioned</SectionHeading>
        <div className="mt-3">
          <DataTable
            rows={organizations.recent}
            rowKey={(tenant) => tenant.id}
            empty="No organization has been provisioned."
            columns={[
              {
                key: 'name',
                header: 'Organization',
                emphasis: 'primary',
                cell: (tenant) => (
                  <Link className="font-medium underline underline-offset-4" href={`/platform/organizations/${tenant.id}`}>
                    {tenant.name}
                  </Link>
                ),
              },
              {
                key: 'lifecycle',
                header: 'Lifecycle',
                cell: (tenant) => <Badge>{tenant.operationalState === 'live' ? 'Live' : 'Setting up'}</Badge>,
              },
              {
                key: 'currency',
                header: 'Currency / timezone',
                emphasis: 'secondary',
                cell: (tenant) => `${tenant.currency || '—'} · ${tenant.timezone}`,
              },
              {
                key: 'activity',
                header: 'Last activity',
                cell: (tenant) => (tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleString('en-CA', { timeZone: tenant.timezone }) : 'Nothing yet'),
              },
            ]}
          />
        </div>
      </section>
    </AppPage>
  );
}
