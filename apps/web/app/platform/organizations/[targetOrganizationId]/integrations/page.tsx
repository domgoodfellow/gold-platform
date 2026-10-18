import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listOrganizationConnections } from '@/lib/domain/integrations/connectors';
import { getTenant } from '@/lib/domain/platform/tenants';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting',
  active: 'Connected',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

/**
 * Support's view of what a business has connected: which app, which account, granted scopes and
 * health. It shows whether a credential is held and never the credential — the read goes
 * through a staff-checked door that has no column able to carry one.
 */
export default async function TenantIntegrations({ params }: PageProps<'/platform/organizations/[targetOrganizationId]/integrations'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));

  const connections = await listOrganizationConnections(db, { organizationId });

  return (
    <AppPage>
      <TenantWorkspaceHeader goldId={goldId} id={organizationId} name={tenant.name} currency={tenant.currency} />
      <section className="mt-6">
        <SectionHeading>Connected apps</SectionHeading>
        <Hint className="mt-1 block">
          A business&apos;s own authorizations to outside apps. Infrastructure GildOps runs for it is under Providers.
        </Hint>
        <div className="mt-3">
          <DataTable
            rows={connections}
            rowKey={(row) => row.id}
            empty="This business has not connected anything."
            columns={[
              {
                key: 'app',
                header: 'App',
                emphasis: 'primary',
                cell: (row) => (
                  <Link href={platformHref(goldId, `integrations/${row.connectorKey}`)} className="font-medium underline-offset-4 hover:underline">
                    {row.connectorName}
                  </Link>
                ),
              },
              { key: 'account', header: 'Account', cell: (row) => row.accountLabel ?? '—' },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{STATUS_LABEL[row.status] ?? row.status}</Badge>,
              },
              { key: 'scopes', header: 'Scopes', cell: (row) => (row.scopes.length > 0 ? row.scopes.join(', ') : '—') },
              { key: 'credential', header: 'Credential', cell: (row) => (row.hasCredential ? 'Held' : 'None') },
              { key: 'resources', header: 'Resources', numeric: true, cell: (row) => row.resourceCount },
              { key: 'verified', header: 'Last verified', cell: (row) => when(row.lastVerifiedAt) },
            ]}
          />
        </div>
      </section>
    </AppPage>
  );
}
