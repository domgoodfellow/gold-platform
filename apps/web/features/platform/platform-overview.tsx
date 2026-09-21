import Link from 'next/link';
import { platformHref } from '@/lib/platform-navigation';
import { AppPage } from '@/components/containers/app-page';
import { SectionHeading } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Widget, WidgetGrid } from '@/components/display/widget';
import type { PlatformOverview as PlatformOverviewData } from '@/lib/domain/platform/overview';

/**
 * The Platform overview, the landing screen. An area dashboard in the `ui-spec.md` §2b sense — the same
 * `Widget`/`WidgetGrid` vocabulary Today uses, not the tenant-configured `dashboards` in
 * `lib/domain/reporting/`. Four numbers and one table, all read straight off `PlatformOverview`
 * (`lib/domain/platform/overview.ts`) with no arithmetic performed here — see
 * `docs/constraints.md`'s "Decided, not yet built" table for what was deliberately left off this
 * screen and why.
 */
export function PlatformOverview({
  goldId,
  organizations,
  failures,
  catalogue,
  rates,
}: PlatformOverviewData & { goldId: string }) {
  const totalFailures = failures.operational + failures.providerReconciliation;

  return (
    <AppPage>
      <PageHeader title="Overview" description="The state of every business running on GOLD." />

      <WidgetGrid className="mt-6">
        <Widget
          title="Organizations"
          value={organizations.total}
          note={organizations.total === 0 ? undefined : `${organizations.live} live · ${organizations.settingUp} setting up`}
          href={platformHref(goldId, 'organizations')}
        />
        <Widget
          title="Attention"
          value={totalFailures}
          note={totalFailures === 0 ? 'Nothing needs attention.' : `${failures.operational} operational · ${failures.providerReconciliation} provider reconciliation`}
          href={platformHref(goldId, 'failures')}
        />
        <Widget
          title="Catalog"
          value={catalogue.products}
          note={`Sellable products · ${catalogue.meters} meter${catalogue.meters === 1 ? '' : 's'} defined`}
          href={platformHref(goldId, 'catalog/products')}
        />
        <Widget
          title="Rate cards"
          value={rates.retail}
          note={`Retail rates recorded · ${rates.provider} provider rate${rates.provider === 1 ? '' : 's'}`}
          href={platformHref(goldId, 'pricing')}
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
                  <Link className="font-medium underline underline-offset-4" href={platformHref(goldId, `organizations/${tenant.id}`)}>
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
