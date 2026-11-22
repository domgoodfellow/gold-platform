import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState } from '@/components/surfaces/section';
import { EconomicsViews } from '@/features/finance/economics/economics-views';
import { PackageSimulator } from '@/features/finance/economics/package-simulator';
import { MarginTargetsSheet, UsageAssumptionSheet } from '@/features/finance/economics/assumptions';
import { listPlanQuotas, listPlans } from '@/lib/domain/catalogue/plans';
import { listDraftScenarios, simulatePackageEconomics } from '@/lib/domain/commercial/package-economics';
import { listMeters } from '@/lib/domain/commercial/catalogue';
import { listTenants } from '@/lib/domain/platform/tenants';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

/** Meters the simulator asks expected usage for: the ones GildOps resells. */
const SIMULATED_METERS = ['voice_minutes', 'sms_segment', 'mms_messages', 'rcs_messages', 'recording_minutes', 'transcription_minutes', 'phone_numbers'];

/**
 * Finance → Economics → Packages (ADR-057): the expected margin of a plan, a draft scenario or a
 * business's agreed price from its prices, allowances, usage assumptions and supplier costs.
 * Simulating reads costs (`cost.read`); recording a scenario, margin target or usage assumption
 * takes `cost.manage`.
 */
export default async function PackagesPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/economics/packages'> & { searchParams: Search }) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireOperatingArea(organizationId, 'finance-economics');
  if (!gate.featureAvailability.has('package_economics')) notFound();
  const mayManage = organization.capabilities.includes('cost.manage');
  const [plans, drafts, meters, tenants] = await Promise.all([listPlans(db), listDraftScenarios(db), listMeters(db), listTenants(db)]);
  const basePlans = plans.filter((plan) => plan.kind === 'plan' && plan.saleStatus !== 'archived');
  const addons = plans.filter((plan) => plan.kind === 'addon' && plan.saleStatus !== 'archived');
  const header = (
    <>
      <PageHeader
        title="Economics"
        crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]}
        actions={mayManage && basePlans.length ? (
          <div className="flex flex-wrap gap-2">
            <MarginTargetsSheet organizationId={organizationId} plans={basePlans.map((plan) => ({ value: plan.id, label: plan.label }))} currency={organization.currency || 'CAD'} />
            <UsageAssumptionSheet
              organizationId={organizationId}
              plans={basePlans.map((plan) => ({ value: plan.id, label: plan.label }))}
              allowances={[...new Map((await Promise.all(basePlans.map((plan) => listPlanQuotas(db, plan.id)))).flat().map((quota) => [quota.allowanceKey, { value: quota.allowanceKey, label: quota.label }])).values()]}
            />
          </div>
        ) : undefined}
      />
      <EconomicsViews organizationId={organizationId} current="packages" portfolio={gate.featureAvailability.has('cost_to_serve')} packages />
    </>
  );
  const first = basePlans[0];
  if (!first) return <AppPage>{header}<EmptyState>No plan is offered yet. Plans are created in Catalog &amp; Pricing.</EmptyState></AppPage>;

  const query = await searchParams;
  const requestedType = one(query.source);
  const requestedId = one(query.id);
  const source = requestedId && ['plan_default', 'draft_scenario', 'organization_agreement'].includes(requestedType)
    ? { type: requestedType as 'plan_default' | 'draft_scenario' | 'organization_agreement', id: requestedId }
    : { type: 'plan_default' as const, id: first.id };
  const initial = await simulatePackageEconomics(db, { source, profile: 'expected' });

  return (
    <AppPage>
      {header}
      <PackageSimulator
        organizationId={organizationId}
        plans={basePlans.map((plan) => ({ id: plan.id, label: plan.label }))}
        addons={addons.map((plan) => ({ id: plan.id, label: plan.label }))}
        organizations={tenants.tenants.map((tenant) => ({ id: tenant.id, label: tenant.name }))}
        drafts={drafts}
        meters={meters.filter((meter) => SIMULATED_METERS.includes(meter.id)).map((meter) => ({ id: meter.id, description: meter.description, unit: meter.unit }))}
        initial={initial}
      />
    </AppPage>
  );
}
