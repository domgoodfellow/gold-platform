import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { SectionHeading } from '@/components/surfaces/section';
import { DataTable } from '@/components/display/table';
import { DefinitionList, Detail } from '@/components/display/data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { getDb } from '@/lib/db/server';
import { telephonyProviderKey } from '@/lib/adapters/telephony';
import { getTenant } from '@/lib/domain/platform/tenants';
import { getProviderAccount, listProviderOrganizationStandings } from '@/lib/domain/providers/accounts';
import { listProviderBindings, listProviderResources } from '@/lib/domain/providers/bindings';
import { localHealth } from '@/lib/domain/providers/reconciliation';
import { TenantHealthBadge } from '@/features/platform/providers/health-badge';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { ProvisionTwilioForm, RegisterPhoneNumberForm, SetResourceStatusForm } from '@/features/platform/organizations/forms';

export const dynamic = 'force-dynamic';

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

export default async function TenantProviders({ params }: PageProps<'/platform/organizations/[targetOrganizationId]/providers'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));

  const providerKey = telephonyProviderKey();
  const [bindings, resources, [standing]] = await Promise.all([
    listProviderBindings(db, { organizationId }),
    listProviderResources(db, { organizationId }),
    listProviderOrganizationStandings(db, { providerKey, organizationId }),
  ]);
  const account = standing?.providerAccountId ? await getProviderAccount(db, standing.providerAccountId) : null;
  const health = standing ? localHealth(standing) : 'not_provisioned';
  const canProvision = health === 'not_provisioned' || health === 'failed';

  return (
    <AppPage>
      <TenantWorkspaceHeader goldId={goldId} id={organizationId} name={tenant.name} currency={tenant.currency} />

      <section className="mt-6">
        <SectionHeading>Communications infrastructure</SectionHeading>
        <div className="mt-3 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <TenantHealthBadge health={health} />
            <Link href={platformHref(goldId, 'providers/twilio?tab=organizations')} className="text-sm underline-offset-4 hover:underline">
              Open in Twilio
            </Link>
          </div>
          <DefinitionList>
            <Detail label="Owned by GildOps account">
              {standing?.bindingId ? (account ? account.label : 'Deployment credential (no account recorded)') : '—'}
            </Detail>
            <Detail label="Subaccount">{standing?.externalAccountId ?? '—'}</Detail>
            <Detail label="Resources">{standing?.resourceCount ?? 0}</Detail>
            <Detail label="Last verified">{when(standing?.lastVerifiedAt ?? null)}</Detail>
            <Detail label="Last reconciled">{when(standing?.lastReconciledAt ?? null)}</Detail>
            {standing?.lastError ? <Detail label="Last error">{standing.lastError}</Detail> : null}
            {standing?.reconciliationDetail ? <Detail label="Reconciliation">{standing.reconciliationDetail}</Detail> : null}
          </DefinitionList>
          {canProvision ? (
            <div>
              <ProvisionTwilioForm organizationId={organizationId} />
              <p className="mt-1 text-sm text-muted">
                {health === 'failed' ? 'Retrying resumes where it stopped and never creates a second subaccount.' : 'Provisions under the default GildOps account.'}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Existing tenant resource</CardDescription>
            <CardTitle>Register number</CardTitle>
          </CardHeader>
          <CardContent>
            <RegisterPhoneNumberForm organizationId={organizationId} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Verification state</CardDescription>
            <CardTitle>Update resource</CardTitle>
          </CardHeader>
          <CardContent>
            <SetResourceStatusForm organizationId={organizationId} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <DataTable
          rows={bindings}
          rowKey={(row) => row.id}
          empty="No provider bindings."
          columns={[
            { key: 'provider', header: 'Provider', emphasis: 'primary', cell: (row) => row.providerKey },
            { key: 'status', header: 'Status', cell: (row) => row.status },
            { key: 'external', header: 'External account ID', cell: (row) => row.externalAccountId ?? '—' },
            { key: 'verified', header: 'Last verified', cell: (row) => (row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : 'Not verified') },
            { key: 'error', header: 'Last error', cell: (row) => row.lastError ?? '—' },
          ]}
        />
      </div>
      <div className="mt-6">
        <DataTable
          rows={resources}
          rowKey={(row) => row.id}
          empty="No provider resources."
          columns={[
            { key: 'type', header: 'Resource', emphasis: 'primary', cell: (row) => row.resourceType },
            { key: 'external', header: 'External ID', cell: (row) => row.externalId },
            { key: 'status', header: 'Status', cell: (row) => row.status },
            { key: 'verified', header: 'Last verified', cell: (row) => (row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : 'Not verified') },
          ]}
        />
      </div>
    </AppPage>
  );
}
