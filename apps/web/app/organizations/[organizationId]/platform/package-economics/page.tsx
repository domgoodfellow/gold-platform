import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { PackageSimulator } from '@/features/platform/commercial/package-simulator';
import { getDb } from '@/lib/db/server';
import { listPlans } from '@/lib/domain/catalogue/plans';
import { listDraftScenarios, simulatePackageEconomics } from '@/lib/domain/commercial/package-economics';
import { listMeters } from '@/lib/domain/commercial/catalogue';
import { listTenants } from '@/lib/domain/platform/tenants';
import { platformAncestry } from '@/lib/platform-navigation';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';

export default async function PackageEconomicsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/platform/package-economics'> & { searchParams: Search }) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  const db = await getDb();
  const [plans, drafts, meters, organizations] = await Promise.all([listPlans(db), listDraftScenarios(db), listMeters(db), listTenants(db)]);
  const basePlans = plans.filter((plan) => plan.kind === 'plan' && plan.saleStatus !== 'archived');
  const addons = plans.filter((plan) => plan.kind === 'addon' && plan.saleStatus !== 'archived');
  const first = basePlans[0];
  if (!first) return <AppPage><PageHeader title="Package economics" crumbs={platformAncestry(organizationId, 'package-economics')} /><p>No active Plans.</p></AppPage>;
  const query = await searchParams;
  const requestedType = one(query.source);
  const requestedId = one(query.id);
  const source = requestedId && ['plan_default','draft_scenario','organization_agreement'].includes(requestedType)
    ? { type: requestedType as 'plan_default' | 'draft_scenario' | 'organization_agreement', id: requestedId }
    : { type: 'plan_default' as const, id: first.id };
  const initial = await simulatePackageEconomics(db, { source, profile: 'expected' });
  return <AppPage><PageHeader title="Package economics" crumbs={platformAncestry(organizationId, 'package-economics')} /><PackageSimulator platformOrganizationId={organizationId} plans={basePlans.map((plan) => ({ id: plan.id, label: plan.label }))} addons={addons.map((plan) => ({ id: plan.id, label: plan.label }))} organizations={organizations.tenants.map((organization) => ({ id: organization.id, label: organization.name }))} drafts={drafts} meters={meters.filter((meter) => ['voice_minutes','sms_segment','mms_messages','rcs_messages','recording_minutes','transcription_minutes','phone_numbers'].includes(meter.id)).map((meter) => ({ id: meter.id, description: meter.description, unit: meter.unit }))} initial={initial} /></AppPage>;
}
