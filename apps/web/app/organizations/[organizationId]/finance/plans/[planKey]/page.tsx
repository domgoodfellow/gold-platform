import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/headers/record-header';
import { EmptyState, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@gold/ui/components/accordion';
import { getDb } from '@/lib/db/server';
import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import { getTenant } from '@/lib/domain/platform/tenants';
import { getProvisionedPlanPrice } from '@/lib/domain/platform-billing/provisioning';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import {
  getPlan,
  listPlans,
  listPlanFeatureGrants,
  listPlanModuleGrants,
  listPlanPrices,
  listPlanOverageRates,
  currentPlanMarginPolicy,
  listPlanUtilizationAssumptions,
  listPlanAddonIds,
  listPlanProductGrants,
  listPlanQuotas,
  planEntitledFeatureIds,
} from '@/lib/domain/catalogue/plans';
import { listAssignmentsForPlan } from '@/lib/domain/catalogue/organization-plans';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import {
  EditPlanSheet,
  FeatureOverrideControl,
  ModuleGrantToggle,
  ProductGrantToggle,
  QuotaSheet,
  RecordPlanPriceSheet,
  RemoveQuotaButton,
  RecordOverageRateSheet,
  PlanEconomicsSettingsSheet,
  PlanAddonToggle,
} from '@/features/finance/plans/plan-forms';
import { ProvisionPriceControl } from '@/features/finance/plans/plan-billing';

export const dynamic = 'force-dynamic';

export default async function FinancePlanDetailPage({ params }: PageProps<'/organizations/[organizationId]/finance/plans/[planKey]'>) {
  const { organizationId, planKey } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  const db = await getDb();

  const plan = await getPlan(db, planKey);
  if (!plan) notFound();

  const [products, productGrants, moduleGrants, featureGrants, entitled, quotas, prices, assignments, overageRates, assumptions, addonIds, allPlans] = await Promise.all([
    listCatalogProducts(db),
    listPlanProductGrants(db, plan.id),
    listPlanModuleGrants(db, plan.id),
    listPlanFeatureGrants(db, plan.id),
    planEntitledFeatureIds(db, plan.id),
    listPlanQuotas(db, plan.id),
    listPlanPrices(db, plan.id),
    listAssignmentsForPlan(db, plan.id),
    listPlanOverageRates(db, plan.id),
    listPlanUtilizationAssumptions(db, plan.id),
    listPlanAddonIds(db, plan.id),
    listPlans(db),
  ]);

  const productGrantSet = new Set(productGrants);
  const moduleGrantSet = new Set(moduleGrants);
  const featureOverrideByFeature = new Map(featureGrants.map((g) => [g.featureId, g.included]));

  const modules = await listCatalogModules(db);
  const modulesByProduct = new Map<string, typeof modules>();
  for (const catalogModule of modules) {
    modulesByProduct.set(catalogModule.productId, [...(modulesByProduct.get(catalogModule.productId) ?? []), catalogModule]);
  }
  const featuresByModule = new Map<string, Awaited<ReturnType<typeof listCatalogFeatures>>>();
  for (const catalogModule of modules) {
    featuresByModule.set(catalogModule.id, await listCatalogFeatures(db, { moduleId: catalogModule.id }));
  }

  const currentPrice = prices.find((p) => p.approvalState === 'approved');
  const marginPolicy = currentPrice ? await currentPlanMarginPolicy(db, plan.id, currentPrice.currency) : null;
  const addonOptions = allPlans.filter((item) => item.kind === 'addon' && item.saleStatus !== 'archived');

  const billingProvider = await platformBillingProvider();
  const provisionedByPriceId = billingProvider
    ? new Map(
        await Promise.all(
          prices.map(async (p) => [
            p.id,
            await getProvisionedPlanPrice(db, { planPriceId: p.id, environment: billingProvider.environment }),
          ] as const),
        ),
      )
    : new Map<string, null>();

  const assignedOrganizations = await Promise.all(
    assignments.map(async (a) => ({ assignment: a, tenant: await getTenant(db, a.organizationId) })),
  );

  return (
    <>
      <RecordHeader
        title={plan.label}
        crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }, { label: 'Plans & Add-ons', href: `/organizations/${organizationId}/finance/plans` }, { label: plan.label }]}
        summary={plan.description}
        actions={<div className="flex gap-2"><ButtonLink href={`${platformHref(organizationId, 'package-economics')}?source=plan_default&id=${plan.id}`} tone="secondary" size="small">Simulate</ButtonLink><EditPlanSheet plan={plan} /></div>}
      />

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="accent">{plan.kind === 'plan' ? 'Plan' : 'Add-on'}</Badge>
        {!plan.billable ? <Badge>Non-billable</Badge> : null}
        {plan.saleStatus !== 'active' ? <Badge>{plan.saleStatus}</Badge> : null}
        <Badge>
          {currentPrice ? `${formatMoney(currentPrice.amountMinor, currentPrice.currency)} / ${currentPrice.billingInterval.replace('_', ' ')}` : 'No standard price'}
        </Badge>
        <Badge>{assignments.length} organization{assignments.length === 1 ? '' : 's'}</Badge>
      </div>

      <Tabs defaultValue="entitlements" className="mt-8">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
          <TabsTrigger value="quotas">Quotas</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="economics">Economics</TabsTrigger>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 text-sm text-muted-foreground">
          <p>
            {productGrants.length} Product{productGrants.length === 1 ? '' : 's'} granted whole, {moduleGrantSet.size}{' '}
            Module{moduleGrantSet.size === 1 ? '' : 's'} granted individually, {featureGrants.length} Feature-level override
            {featureGrants.length === 1 ? '' : 's'}, {quotas.length} quota definition{quotas.length === 1 ? '' : 's'}.
          </p>
        </TabsContent>

        <TabsContent value="entitlements" className="mt-4">
          <p className="mb-4 text-sm text-muted-foreground">
            Including a whole Product grants every currently <strong>available</strong> Feature under
            it — never a planned or partial one. Override an individual Feature to include an
            add-on Feature or exclude one the Product grant would otherwise cover.
          </p>
          <Accordion type="multiple">
            {products.map((product) => {
              const productModules = modulesByProduct.get(product.id) ?? [];
              const productGranted = productGrantSet.has(product.key);
              return (
                <AccordionItem key={product.id} value={product.id}>
                  <AccordionTrigger>
                    <div className="flex flex-1 items-center justify-between pr-4">
                      <span className="font-medium">{product.label}</span>
                      {productGranted ? <Badge tone="success">All available included</Badge> : null}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="mb-3">
                      <ProductGrantToggle planId={plan.id} planKey={plan.key} productKey={product.key} granted={productGranted} />
                    </div>
                    {productModules.map((module) => {
                      const moduleGranted = moduleGrantSet.has(module.id);
                      const features = featuresByModule.get(module.id) ?? [];
                      return (
                        <div key={module.id} className="mb-4 border-l-2 border-border pl-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{module.label}</p>
                            {!productGranted ? (
                              <ModuleGrantToggle planId={plan.id} planKey={plan.key} moduleId={module.id} granted={moduleGranted} />
                            ) : null}
                          </div>
                          <ul className="mt-2 flex flex-col divide-y divide-border">
                            {features.map((feature) => {
                              const override = featureOverrideByFeature.has(feature.id) ? featureOverrideByFeature.get(feature.id)! : null;
                              const isEntitled = entitled.has(feature.id);
                              return (
                                <li key={feature.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                  <div>
                                    <p className="text-sm">{feature.label}</p>
                                    <FeatureStatusBadges feature={feature} />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge tone={isEntitled ? 'success' : 'neutral'}>{isEntitled ? 'Granted' : 'Not granted'}</Badge>
                                    <FeatureOverrideControl planId={plan.id} planKey={plan.key} featureId={feature.id} override={override} />
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </TabsContent>

        <TabsContent value="quotas" className="mt-4">
          <div className="mb-3 flex justify-end">
            <QuotaSheet planId={plan.id} planKey={plan.key} />
          </div>
          {quotas.length === 0 ? (
            <EmptyState>This Plan has no structured usage limits.</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {quotas.map((quota) => (
                <div key={quota.id} className="rounded border border-border p-3">
                  <p className="font-medium">{quota.label}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Included</dt>
                    <dd>
                      {quota.includedQuantity.toLocaleString()} {quota.unit}
                      {quota.period !== 'none' ? ` / ${quota.period}` : ''}
                    </dd>
                    <dt className="text-muted-foreground">Hard limit</dt>
                    <dd>{quota.hardLimit !== null ? quota.hardLimit.toLocaleString() : 'None'}</dd>
                    <dt className="text-muted-foreground">Overage</dt>
                    <dd>{quota.overageBehavior.replaceAll('_', ' ')}</dd>
                    <dt className="text-muted-foreground">Type</dt>
                    <dd>{quota.allowanceType.replaceAll('_', ' ')}</dd>
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <QuotaSheet planId={plan.id} planKey={plan.key} quota={quota} />
                    {quota.overageBehavior === 'metered' && quota.meterId ? <RecordOverageRateSheet planId={plan.id} planKey={plan.key} meterId={quota.meterId} label={quota.label} currency={currentPrice?.currency} /> : null}
                    <RemoveQuotaButton planId={plan.id} planKey={plan.key} allowanceKey={quota.allowanceKey} />
                  </div>
                  {quota.meterId ? <p className="mt-2 text-xs text-muted">{overageRates.find((rate) => rate.meterId === quota.meterId) ? `Current Plan rate: ${(overageRates.find((rate) => rate.meterId === quota.meterId)!.unitAmountMicros / 100_000_000).toFixed(4)} ${overageRates.find((rate) => rate.meterId === quota.meterId)!.currency} / ${quota.unit}` : 'No Plan overage rate'}</p> : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pricing" className="mt-4">
          <div className="mb-3 flex justify-end">
            <RecordPlanPriceSheet planId={plan.id} planKey={plan.key} />
          </div>
          {prices.length === 0 ? (
            <EmptyState>No standard price has been recorded for this Plan.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {prices.map((price) => (
                <li key={price.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-medium">
                    {formatMoney(price.amountMinor, price.currency)} / {price.billingInterval.replace('_', ' ')}
                  </span>
                  <span className="text-muted-foreground">Effective {new Date(price.effectiveFrom).toLocaleDateString()}</span>
                  <Badge tone={price.approvalState === 'approved' ? 'success' : 'neutral'}>{price.approvalState}</Badge>
                  <ProvisionPriceControl
                    planId={plan.id}
                    planKey={plan.key}
                    planPriceId={price.id}
                    provisioned={provisionedByPriceId.get(price.id) ?? null}
                    environment={billingProvider?.environment ?? null}
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="economics" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><SectionHeading>Planning assumptions</SectionHeading><p className="mt-1 text-sm text-muted">Low defaults to 25%; Max allowance is always 100%. Expected and Heavy are versioned per allowance.</p></div>
            <div className="flex gap-2"><ButtonLink href={`${platformHref(organizationId, 'package-economics')}?source=plan_default&id=${plan.id}`} tone="secondary">Open simulator</ButtonLink><PlanEconomicsSettingsSheet planId={plan.id} planKey={plan.key} currency={currentPrice?.currency ?? 'CAD'} quotas={quotas} policy={marginPolicy} assumptions={assumptions} /></div>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-4 border-y border-border py-3 text-sm"><div><dt className="text-muted">Target margin</dt><dd className="font-medium">{marginPolicy ? `${(marginPolicy.targetMargin * 100).toFixed(1)}%` : 'Not set'}</dd></div><div><dt className="text-muted">Warning below</dt><dd>{marginPolicy ? `${(marginPolicy.warningMargin * 100).toFixed(1)}%` : '—'}</dd></div><div><dt className="text-muted">Hard floor</dt><dd>{marginPolicy ? `${(marginPolicy.hardFloorMargin * 100).toFixed(1)}%` : '—'}</dd></div></dl>
          {plan.kind === 'plan' ? <div className="mt-6"><SectionHeading>Add-ons</SectionHeading><div className="mt-2">{addonOptions.map((addon) => <PlanAddonToggle key={addon.id} planId={plan.id} planKey={plan.key} addonId={addon.id} label={addon.label} attached={addonIds.includes(addon.id)} />)}</div></div> : null}
        </TabsContent>

        <TabsContent value="organizations" className="mt-4">
          <DataTable
            rows={assignedOrganizations}
            rowKey={({ assignment }) => assignment.id}
            empty="No organization is currently assigned this Plan."
            columns={[
              {
                key: 'organization',
                header: 'Organization',
                emphasis: 'primary',
                cell: ({ assignment, tenant }) => (
                  <Link href={platformHref(organizationId, `organizations/${assignment.organizationId}`)} className="underline underline-offset-4">
                    {tenant?.name ?? assignment.organizationId}
                  </Link>
                ),
              },
              {
                key: 'period',
                header: 'Effective period',
                cell: ({ assignment }) => (
                  <>
                    {assignment.periodStart} – {assignment.periodEnd === '9999-12-31' ? 'ongoing' : assignment.periodEnd}
                  </>
                ),
              },
              {
                key: 'kind',
                header: 'Kind',
                cell: ({ assignment }) => <Badge>{assignment.planKind}</Badge>,
              },
            ]}
          />
          <SectionHeading className="mt-8">Advanced</SectionHeading>
          <Hint className="mt-1 font-mono text-xs">key: {plan.key} · id: {plan.id}</Hint>
        </TabsContent>
      </Tabs>
    </>
  );
}
