import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { EmptyState } from '@/components/surfaces/section';
import { AllowanceMeter } from '@/features/catalogue/allowance-meter';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { getDb } from '@/lib/db/server';
import { organizationAllowanceStates } from '@/lib/domain/commercial/allowances';
import { getTenant } from '@/lib/domain/platform/tenants';
import { platformHref } from '@/lib/platform-navigation';
import { platformParams, requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

/**
 * What one business has used against each allowance — the metering the runtime enforces, in units,
 * never money. What that usage cost or earned is GildOps' Finance (Costs and Economics).
 */
export default async function AdministrationOrganizationUsage({ params }: PageProps<'/organizations/[organizationId]/administration/organizations/[targetOrganizationId]/usage'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const [tenant, allowances] = await Promise.all([getTenant(db, organizationId), organizationAllowanceStates(db, { organizationId })]);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));
  return (
    <AppPage>
      <TenantWorkspaceHeader goldId={goldId} id={organizationId} slug={tenant.slug} name={tenant.name} currency={tenant.currency} />
      <div className="mt-6">
        {allowances.length === 0 ? (
          <EmptyState>No allowance is metered for this business.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {allowances.map((state) => (
              <li key={state.allowanceKey}>
                <AllowanceMeter state={state} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppPage>
  );
}
