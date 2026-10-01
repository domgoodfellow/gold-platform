import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { AppPage } from '@/components/layout/app-page';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { PageHeader } from '@/components/headers/page-header';
import { SectionHeading } from '@/components/surfaces/section';
import { ButtonLink } from '@/components/controls/button';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { ProviderOrganizationStanding } from '@/lib/domain/providers/accounts';
import { localHealth } from '@/lib/domain/providers/reconciliation';
import type { TwilioProviderModel } from '@/lib/application/platform/twilio-provider';
import { ReadinessBadge, TenantHealthBadge } from '@/features/platform/providers/health-badge';
import { ReconcileControl } from '@/features/platform/providers/twilio-account-controls';
import { TwilioConfiguration } from '@/features/platform/providers/twilio-configuration';
import { ProvisionTwilioForm } from '@/features/platform/organizations/forms';

const TABS = [
  ['overview', 'Overview'],
  ['accounts', 'Accounts'],
  ['organizations', 'Organizations'],
] as const;
export type Tab = (typeof TABS)[number][0];

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function TwilioProviderScreen({ goldId, tab, model }: { goldId: string; tab: Tab; model: TwilioProviderModel }) {
  const { accounts, standings, readiness, primary, attention, accountLabel, organizationNames,
    standingCountByAccount, activeBoundCount, unprovisionedCount, resourceTotal, bootstrapConfigured } = model;

  return (
    <AppPage>
      <PageHeader
        title="Twilio"
        crumbs={[...platformAncestry(goldId, 'providers'), { label: 'Providers', href: platformHref(goldId, 'providers') }]}
        meta={
          <span className="inline-flex items-center gap-2">
            <ReadinessBadge state={readiness.state} />
            {readiness.summary}
          </span>
        }
        configure
      />

      <nav aria-label="Twilio" className="mb-6 flex gap-1 border-b border-border">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={key === 'overview' ? platformHref(goldId, 'providers/twilio') : platformHref(goldId, `providers/twilio?tab=${key}`)}
            aria-current={tab === key ? 'page' : undefined}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === key ? 'border-foreground font-medium' : 'border-transparent text-muted hover:text-foreground',
              FOCUS_RING,
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' ? (
        <div className="flex flex-col gap-6">
          {readiness.reasons.length > 0 ? (
            <Alert variant={readiness.state === 'attention' ? 'destructive' : 'default'}>
              <AlertTitle>{readiness.summary}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <DefinitionList>
            <Detail label="Default GildOps account">{primary ? `${primary.label} · ${primary.externalAccountId ?? 'no SID'}` : 'None recorded'}</Detail>
            <Detail label="Credential type">{primary?.credentialKind ?? '—'}</Detail>
            <Detail label="Last verified">{primary ? when(primary.lastVerifiedAt) : '—'}</Detail>
            <Detail label="Organizations with a subaccount">{activeBoundCount}</Detail>
            <Detail label="Organizations not provisioned">{unprovisionedCount}</Detail>
            <Detail label="Resources beneath them">{resourceTotal}</Detail>
            <Detail label="Deployment credential">{bootstrapConfigured ? 'Configured (used by existing scopes)' : 'Not configured'}</Detail>
          </DefinitionList>

          <section>
            <SectionHeading>Needs attention</SectionHeading>
            {attention.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No organization is failing or differs from the provider.</p>
            ) : (
              <div className="mt-3">
                <TenantTable goldId={goldId} rows={attention} accountLabel={accountLabel} />
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'accounts' ? (
        <div className="flex flex-col gap-4">
          <div>
            <ButtonLink href={platformHref(goldId, 'providers/twilio/configure?account=new')} size="small">
              Add account
            </ButtonLink>
          </div>
          <DataTable
            rows={accounts}
            rowKey={(account) => account.id}
            empty="No GildOps account is recorded. Existing scopes use the deployment’s own credential."
            columns={[
              {
                key: 'label',
                header: 'Account',
                emphasis: 'primary',
                cell: (account) => (
                  <div>
                    <span className="font-medium">{account.label}</span>
                    {account.isDefault ? <Badge className="ml-2">Default</Badge> : null}
                    <span className="block font-mono text-xs text-muted-foreground">{account.externalAccountId ?? '—'}</span>
                  </div>
                ),
              },
              {
                key: 'credential',
                header: 'Credential',
                cell: (account) => (
                  <div>
                    {account.credentialKind}
                    <span className="block text-xs text-muted-foreground">
                      {account.credentialSetAt ? `Set ${when(account.credentialSetAt)}` : 'None stored'}
                      {account.credentialIdentifier ? ` · ${account.credentialIdentifier}` : ''}
                    </span>
                  </div>
                ),
              },
              {
                key: 'state',
                header: 'State',
                cell: (account) => (
                  <div>
                    {account.status === 'disabled' ? 'Disabled' : 'Active'} · {account.verificationState}
                    {account.verificationError ? <span className="block text-xs text-danger">{account.verificationError}</span> : null}
                  </div>
                ),
              },
              { key: 'verified', header: 'Last verified', cell: (account) => when(account.lastVerifiedAt) },
              {
                key: 'organizations',
                header: 'Organizations',
                numeric: true,
                cell: (account) => standingCountByAccount.get(account.id) ?? 0,
              },
            ]}
            actions={(account) => (
              <ButtonLink href={platformHref(goldId, `providers/twilio/configure?account=${account.id}`)} tone="secondary" size="small">
                Configure
              </ButtonLink>
            )}
          />
        </div>
      ) : null}

      {tab === 'organizations' ? (
        <div className="flex flex-col gap-4">
          {primary && primary.verificationState === 'verified' && primary.status === 'active' ? (
            <ReconcileControl accountId={primary.id} organizationNames={organizationNames} />
          ) : (
            <p className="text-sm text-muted">Verify an active account to reconcile organizations against the provider.</p>
          )}
          <TenantTable goldId={goldId} rows={standings} accountLabel={accountLabel} withProvisioning />
        </div>
      ) : null}

      <ConfigureRegistrar title="Configure Twilio" settingsHref={platformHref(goldId, `providers/twilio/configure${primary ? `?account=${primary.id}` : '?account=new'}`)}>
        <TwilioConfiguration account={primary} />
      </ConfigureRegistrar>
    </AppPage>
  );
}

function TenantTable({
  goldId,
  rows,
  accountLabel,
  withProvisioning,
}: {
  goldId: string;
  rows: ProviderOrganizationStanding[];
  accountLabel: Map<string, string>;
  withProvisioning?: boolean;
}) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.organizationId}
      empty="No organizations."
      columns={[
        {
          key: 'organization',
          header: 'Organization',
          emphasis: 'primary',
          cell: (row) => (
            <Link href={platformHref(goldId, `organizations/${row.organizationId}/providers`)} className="font-medium underline-offset-4 hover:underline">
              {row.organizationName}
            </Link>
          ),
        },
        { key: 'state', header: 'State', cell: (row) => <TenantHealthBadge health={localHealth(row)} /> },
        { key: 'subaccount', header: 'Subaccount', cell: (row) => <span className="font-mono text-xs">{row.externalAccountId ?? '—'}</span> },
        {
          key: 'account',
          header: 'Under account',
          cell: (row) => (row.bindingId ? (row.providerAccountId ? (accountLabel.get(row.providerAccountId) ?? 'Unknown account') : 'Deployment credential') : '—'),
        },
        { key: 'resources', header: 'Resources', numeric: true, cell: (row) => row.resourceCount },
        { key: 'reconciled', header: 'Last reconciled', cell: (row) => when(row.lastReconciledAt) },
        {
          key: 'detail',
          header: 'Detail',
          cell: (row) => <span className="text-xs text-muted-foreground">{row.lastError ?? row.reconciliationDetail ?? '—'}</span>,
        },
      ]}
      actions={
        withProvisioning
          ? (row) =>
              !row.bindingId || row.bindingStatus === 'failed' ? <ProvisionTwilioForm organizationId={row.organizationId} /> : null
          : undefined
      }
    />
  );
}
