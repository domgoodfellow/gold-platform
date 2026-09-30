import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { TextInput } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { ProvisionOrganizationDialog } from '@/features/platform/organizations/provision-organization-dialog';
import { getDb } from '@/lib/db/server';
import { listTenants } from '@/lib/domain/platform/tenants';

export default async function PlatformOrganizationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/platform/organizations'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.organizations');
  const { tenants, total } = await listTenants(await getDb());
  const query = String((await searchParams).q ?? '').trim().toLowerCase();
  const visible = query ? tenants.filter((tenant) => tenant.name.toLowerCase().includes(query) || tenant.id.toLowerCase().includes(query)) : tenants;

  return (
    <AppPage>
      <PageHeader
        title="Organizations"
        crumbs={platformAncestry(goldId, 'organizations')}
        meta={`${total === 1 ? '1 organization' : `${total} organizations`} on GildOps`}
        actions={<ProvisionOrganizationDialog />}
      />
      <form method="get" role="search" className="relative max-w-md">
        <Search aria-hidden size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <TextInput name="q" defaultValue={query} placeholder="Search organizations or tenant IDs" aria-label="Search organizations" className="pl-9" />
      </form>
      <div className="mt-6">
        <DataTable
          rows={visible}
          rowKey={(tenant) => tenant.id}
          empty={query ? 'No organizations match this search.' : 'No organization has been provisioned.'}
          columns={[
            { key: 'name', header: 'Organization', emphasis: 'primary', cell: (tenant) => <div><Link className="font-medium underline underline-offset-4" href={platformHref(goldId, `organizations/${tenant.id}`)}>{tenant.name}</Link><span className="block text-xs text-muted-foreground">{tenant.id}</span></div> },
            { key: 'lifecycle', header: 'Lifecycle', cell: () => <Badge>provisioned</Badge> },
            { key: 'currency', header: 'Currency / timezone', cell: (tenant) => <div>{tenant.currency || '—'}<span className="block text-xs text-muted-foreground">{tenant.timezone}</span></div> },
            { key: 'modules', header: 'Modules', cell: (tenant) => tenant.moduleKeys.length ? <div className="flex max-w-md flex-wrap gap-1">{tenant.moduleKeys.map((key) => <Badge key={key}>{key}</Badge>)}</div> : 'Kernel only' },
            { key: 'activity', header: 'Last activity', cell: (tenant) => tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleString('en-CA', { timeZone: tenant.timezone }) : 'Nothing yet' },
          ]}
        />
      </div>
    </AppPage>
  );
}
