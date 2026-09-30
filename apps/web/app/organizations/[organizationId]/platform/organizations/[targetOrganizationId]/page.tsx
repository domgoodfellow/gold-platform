import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { Button } from '@/components/controls/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { activeSupportSession, listMembersForSupport } from '@/lib/domain/platform/support';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { SupportSessionBanner, SupportSessionOpener } from '@/features/platform/organizations/support-view';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { initializeGoldWorkspaceAction } from './actions';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import { describeServiceAccess, getOrganizationServiceAccess } from '@/lib/domain/platform-billing/service-access';

export const dynamic = 'force-dynamic';

export default async function PlatformOrganizationOverview({ params }: PageProps<'/organizations/[organizationId]/platform/organizations/[targetOrganizationId]'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await params;
  await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));

  const session = await activeSupportSession(db, { organizationId });
  const members = session ? await listMembersForSupport(db, { organizationId }) : [];
  // Real membership only, never staff authority standing in for one (see tenant-workspace.tsx).
  const myOrganizations = await listMyOrganizations(db);
  const canOpenBusiness = myOrganizations.some((organization) => organization.id === organizationId);
  const [currentPlan, goldInternal] = await Promise.all([
    currentPlanAssignment(db, { organizationId }), findGoldInternalOrganization(db, myOrganizations),
  ]);
  // The same resolver the tenant's own guard runs — staff read the answer, never reinterpret a Stripe status.
  const access = await getOrganizationServiceAccess(db, { organizationId, environment: platformBillingEnvironment() });
  const canInitializeGold = canOpenBusiness && !currentPlan && !goldInternal;

  return <AppPage><TenantWorkspaceHeader goldId={goldId} id={tenant.id} name={tenant.name} currency={tenant.currency} canOpenBusiness={canOpenBusiness} />
    {canInitializeGold ? <Card className="mt-6 border-primary/30"><CardHeader><CardDescription>Staff-only bootstrap</CardDescription><CardTitle>Use as GildOps workspace</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>Assigns the non-billable GOLD Internal Plan without matching this organization&apos;s name.</span><form action={initializeGoldWorkspaceAction.bind(null, organizationId)}><Button type="submit">Use as GildOps workspace</Button></form></CardContent></Card> : currentPlan ? <p className="mt-6 text-sm text-muted-foreground">Current base Plan is already assigned; GildOps initialization will not replace it.</p> : goldInternal ? <p className="mt-6 text-sm text-muted-foreground">A GildOps internal workspace is already initialized.</p> : null}
    <Card className="mt-6"><CardHeader><CardDescription>Commercial access</CardDescription><CardTitle className="text-xl">{access.permitted ? 'Service available' : 'Service locked'}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{describeServiceAccess(access)}{access.planKey ? ` Plan: ${access.planKey}.` : ''}</CardContent></Card>
    <div className="mt-6 grid gap-4 md:grid-cols-3"><Card><CardHeader><CardDescription>Tenant lifecycle</CardDescription><CardTitle className="text-xl">Active workspace</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Created {new Date(tenant.createdAt).toLocaleDateString()}.</CardContent></Card><Card><CardHeader><CardDescription>Optional modules</CardDescription><CardTitle className="text-xl">{tenant.moduleKeys.length}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{tenant.moduleKeys.length ? tenant.moduleKeys.join(', ') : 'No optional modules recorded.'}</CardContent></Card><Card><CardHeader><CardDescription>Last activity</CardDescription><CardTitle className="text-xl">{tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleDateString() : 'No activity'}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Timezone: {tenant.timezone}</CardContent></Card></div><div className="mt-6">{session ? <SupportSessionBanner organizationId={organizationId} session={session} members={members} /> : <SupportSessionOpener organizationId={organizationId} />}</div></AppPage>;
}
