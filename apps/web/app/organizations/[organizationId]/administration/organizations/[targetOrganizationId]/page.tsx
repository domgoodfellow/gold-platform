import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { Button, ButtonLink } from '@/components/controls/button';
import { Card, CardContent, CardHeader, CardTitle } from '@gold/ui/components/card';
import { MetricTile, StatePill } from '@/components/operational/primitives';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { subscriptionsForTenants } from '@/lib/domain/catalogue/organization-plans';
import { activeSupportSession, listMembersForSupport } from '@/lib/domain/platform/support';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { SupportSessionBanner, SupportSessionOpener } from '@/features/platform/organizations/support-view';
import { SaveTemplateDialog } from '@/features/platform/organizations/forms';
import { businessIndustry } from '@/lib/domain/configuration/proposals';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { callerOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { customerForTenant } from '@/lib/domain/customers/client-tenants';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import { describeServiceAccess, getOrganizationServiceAccess } from '@/lib/domain/platform-billing/service-access';
import { platformHref } from '@/lib/platform-navigation';
import { platformParams, requirePlatformArea, requirePlatformScope } from '@/lib/route/platform';
import { initializeGoldWorkspaceAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * One provisioned business in Administration: its identity, lifecycle, whether the platform lets
 * it work, and privileged support. What it subscribes to and pays is GildOps' Finance, and who it
 * is as a customer is GildOps' CRM — each linked here only for a member who may open it there, so
 * this record never repeats or edits either.
 */
export default async function AdministrationOrganization({ params }: PageProps<'/organizations/[organizationId]/administration/organizations/[targetOrganizationId]'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await platformParams(params);
  const permissions = await requirePlatformArea(goldId, 'platform.organizations');
  const { organization: gold } = await requirePlatformScope(goldId);
  const db = await getDb();
  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));

  const may = (capability: (typeof gold.capabilities)[number]) => gold.capabilities.includes(capability);
  const [session, myOrganizations, currentPlan, operating, customerId, access, subscriptionByTenant] = await Promise.all([
    activeSupportSession(db, { organizationId }),
    listMyOrganizations(db),
    currentPlanAssignment(db, { organizationId }),
    callerOperatingOrganization(db),
    may('customer.read') ? customerForTenant(db, { organizationId: goldId, tenantId: organizationId }) : Promise.resolve(null),
    // The resolver the business's own guard runs — read, never reinterpreted from a billing status.
    getOrganizationServiceAccess(db, { organizationId, environment: platformBillingEnvironment(), operationalState: tenant.operationalState }),
    may('subscription.read') ? subscriptionsForTenants(db, { organizationId: goldId, tenantIds: [organizationId] }) : Promise.resolve(new Map<string, string>()),
  ]);
  const subscriptionId = subscriptionByTenant.get(organizationId);
  const members = session ? await listMembersForSupport(db, { organizationId }) : [];
  // Real membership only, never staff authority standing in for one (see tenant-workspace.tsx).
  const canOpenBusiness = myOrganizations.some((organization) => organization.id === organizationId);
  const canInitializeGold = canOpenBusiness && !currentPlan && !operating;

  return (
    <AppPage>
      <TenantWorkspaceHeader
        goldId={goldId}
        id={tenant.id}
        slug={tenant.slug}
        name={tenant.name}
        currency={tenant.currency}
        canOpenBusiness={canOpenBusiness}
        actions={
          <>
            {subscriptionId ? <ButtonLink href={`/organizations/${goldId}/finance/subscriptions/${subscriptionId}`} tone="secondary" size="small">Subscription</ButtonLink> : null}
            {customerId ? <ButtonLink href={`/organizations/${goldId}/crm/contacts/${customerId}`} tone="secondary" size="small">Customer</ButtonLink> : null}
            {permissions.has('platform.catalogue') ? <SaveTemplateDialog organizationId={organizationId} businessName={tenant.name} industry={await businessIndustry(db, organizationId)} /> : null}
          </>
        }
      />
      {canInitializeGold ? (
        <Card variant="accent" className="mt-6">
          <CardHeader><CardTitle>Use as GildOps workspace</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Makes this organization GildOps&apos; operating organization and assigns the non-billable GildOps Internal plan.</span>
            <form action={initializeGoldWorkspaceAction.bind(null, organizationId)}><Button type="submit">Use as GildOps workspace</Button></form>
          </CardContent>
        </Card>
      ) : null}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <MetricTile
          label="Service access"
          value={access.permitted ? 'Available' : 'Locked'}
          detail={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><StatePill tone={access.permitted ? 'success' : 'danger'}>{access.permitted ? 'Available' : 'Locked'}</StatePill><span>{describeServiceAccess(access)}</span></span>}
        />
        <MetricTile label="Lifecycle" value={tenant.operationalState === 'live' ? 'Live' : 'Setting up'} detail={`Created ${new Date(tenant.createdAt).toLocaleDateString()} · ${tenant.timezone}`} />
        <MetricTile label="Last activity" value={tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleDateString() : 'No activity'} detail={tenant.moduleKeys.length ? `Optional features: ${tenant.moduleKeys.join(', ')}` : 'No optional features recorded.'} />
      </div>
      <div className="mt-6">{session ? <SupportSessionBanner organizationId={organizationId} session={session} members={members} /> : <SupportSessionOpener organizationId={organizationId} />}</div>
    </AppPage>
  );
}
