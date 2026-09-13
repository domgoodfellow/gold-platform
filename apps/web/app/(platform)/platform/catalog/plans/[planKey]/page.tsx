import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/containers/record-header';
import { SectionHeading } from '@/components/containers/section';
import { Badge } from '@/components/display/data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@gold/ui/components/accordion';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import {
  getPlan,
  listPlanFeatureGrants,
  listPlanModuleGrants,
  listPlanPrices,
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
} from '@/features/platform/catalog/plan-forms';

export const dynamic = 'force-dynamic';

export default async function PlanDetailPage({ params }: PageProps<'/platform/catalog/plans/[planKey]'>) {
  const { planKey } = await params;
  const db = await getDb();

  const plan = await getPlan(db, planKey);
  if (!plan) notFound();

  const [products, productGrants, moduleGrants, featureGrants, entitled, quotas, prices, assignments] = await Promise.all([
    listCatalogProducts(db),
    listPlanProductGrants(db, plan.id),
    listPlanModuleGrants(db, plan.id),
    listPlanFeatureGrants(db, plan.id),
    planEntitledFeatureIds(db, plan.id),
    listPlanQuotas(db, plan.id),
    listPlanPrices(db, plan.id),
    listAssignmentsForPlan(db, plan.id),
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
  const assignedOrganizations = await Promise.all(
    assignments.map(async (a) => ({ assignment: a, tenant: await getTenant(db, a.organizationId) })),
  );

  return (
    <>
      <RecordHeader
        title={plan.label}
        crumbs={[{ label: 'Plans & Add-ons', href: '/platform/catalog/plans' }, { label: plan.label }]}
        summary={plan.description}
        actions={<EditPlanSheet plan={plan} />}
      />

      <div className="mt-4 flex flex-wrap gap-1.5">
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
            <p className="text-sm text-muted-foreground">This Plan has no structured usage limits.</p>
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
                    <dd>{quota.overagePolicy.replace('_', ' ')}</dd>
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <QuotaSheet planId={plan.id} planKey={plan.key} quota={quota} />
                    <RemoveQuotaButton planId={plan.id} planKey={plan.key} allowanceKey={quota.allowanceKey} />
                  </div>
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
            <p className="text-sm text-muted-foreground">No standard price has been recorded for this Plan.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {prices.map((price) => (
                <li key={price.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-medium">
                    {formatMoney(price.amountMinor, price.currency)} / {price.billingInterval.replace('_', ' ')}
                  </span>
                  <span className="text-muted-foreground">Effective {new Date(price.effectiveFrom).toLocaleDateString()}</span>
                  <Badge tone={price.approvalState === 'approved' ? 'success' : 'neutral'}>{price.approvalState}</Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="organizations" className="mt-4">
          {assignedOrganizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No organization is currently assigned this Plan.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium">Organization</th>
                  <th className="py-2 pr-4 font-medium">Effective period</th>
                  <th className="py-2 font-medium">Kind</th>
                </tr>
              </thead>
              <tbody>
                {assignedOrganizations.map(({ assignment, tenant }) => (
                  <tr key={assignment.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <Link href={`/platform/organizations/${assignment.organizationId}`} className="underline underline-offset-4">
                        {tenant?.name ?? assignment.organizationId}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      {assignment.periodStart} – {assignment.periodEnd === '9999-12-31' ? 'ongoing' : assignment.periodEnd}
                    </td>
                    <td className="py-2">
                      <Badge>{assignment.planKind}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <SectionHeading className="mt-8">Advanced</SectionHeading>
          <p className="mt-1 font-mono text-xs text-muted-foreground">key: {plan.key} · id: {plan.id}</p>
        </TabsContent>
      </Tabs>
    </>
  );
}
