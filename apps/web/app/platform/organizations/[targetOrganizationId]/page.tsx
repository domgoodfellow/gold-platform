import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { Button } from '@/components/controls/button';
import { Card, CardContent, CardHeader, CardTitle } from '@gold/ui/components/card';
import { MetricTile, StatePill } from '@/components/operational/primitives';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { activeSupportSession, listMembersForSupport } from '@/lib/domain/platform/support';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { SupportSessionBanner, SupportSessionOpener } from '@/features/platform/organizations/support-view';
import { SaveTemplateDialog } from '@/features/platform/organizations/forms';
import { businessIndustry } from '@/lib/domain/configuration/proposals';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { callerOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { initializeGoldWorkspaceAction } from './actions';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import { describeServiceAccess, getOrganizationServiceAccess } from '@/lib/domain/platform-billing/service-access';

export const dynamic = 'force-dynamic';

export default async function PlatformOrganizationOverview({ params }: PageProps<'/platform/organizations/[targetOrganizationId]'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await platformParams(params);
  const permissions = await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));

  const session = await activeSupportSession(db, { organizationId });
  const members = session ? await listMembersForSupport(db, { organizationId }) : [];
  // Real membership only, never staff authority standing in for one (see tenant-workspace.tsx).
  const myOrganizations = await listMyOrganizations(db);
  const canOpenBusiness = myOrganizations.some((organization) => organization.id === organizationId);
  const [currentPlan, operating] = await Promise.all([
    currentPlanAssignment(db, { organizationId }), callerOperatingOrganization(db),
  ]);
  // The same resolver the tenant's own guard runs — staff read the answer, never reinterpret a Stripe status.
  const access = await getOrganizationServiceAccess(db, { organizationId, environment: platformBillingEnvironment(), operationalState: tenant.operationalState });
  const canInitializeGold = canOpenBusiness && !currentPlan && !operating;

  return <AppPage><TenantWorkspaceHeader goldId={goldId} id={tenant.id} name={tenant.name} currency={tenant.currency} canOpenBusiness={canOpenBusiness}
    actions={permissions.has('platform.catalogue') ? <SaveTemplateDialog organizationId={organizationId} businessName={tenant.name} industry={await businessIndustry(db, organizationId)} /> : null} />
    {canInitializeGold ? <Card className="mt-6 border-primary/30"><CardHeader><CardTitle>Use as GildOps workspace</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>Makes this organization GildOps&apos; operating organization and assigns the non-billable GOLD Internal Plan.</span><form action={initializeGoldWorkspaceAction.bind(null, organizationId)}><Button type="submit">Use as GildOps workspace</Button></form></CardContent></Card> : currentPlan ? <p className="mt-6 text-sm text-muted-foreground">Current base Plan is already assigned; GildOps initialization will not replace it.</p> : operating ? <p className="mt-6 text-sm text-muted-foreground">A GildOps operating organization is already designated.</p> : null}
    <div className="mt-6"><MetricTile label="Commercial access" value={access.planKey ?? 'No Plan'} detail={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><StatePill tone={access.permitted ? 'success' : 'danger'}>{access.permitted ? 'Available' : 'Locked'}</StatePill><span>{describeServiceAccess(access)}</span></span>} /></div>
    <div className="mt-6 grid gap-4 md:grid-cols-3"><MetricTile label="Tenant lifecycle" value="Active workspace" detail={`Created ${new Date(tenant.createdAt).toLocaleDateString()}.`} /><MetricTile label="Optional modules" value={tenant.moduleKeys.length} detail={tenant.moduleKeys.length ? tenant.moduleKeys.join(', ') : 'No optional modules recorded.'} /><MetricTile label="Last activity" value={tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleDateString() : 'No activity'} detail={`Timezone: ${tenant.timezone}`} /></div><div className="mt-6">{session ? <SupportSessionBanner organizationId={organizationId} session={session} members={members} /> : <SupportSessionOpener organizationId={organizationId} />}</div></AppPage>;
}
