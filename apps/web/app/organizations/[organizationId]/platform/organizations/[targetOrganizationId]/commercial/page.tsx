import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { SectionHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { listOrganizationTerms, moduleCommercialState } from '@/lib/domain/commercial/terms';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import { getPlanById, listPlans } from '@/lib/domain/catalogue/plans';
import {
  currentAddonAssignments,
  currentPlanAssignment,
  listOrganizationPlanAgreements,
  listOrganizationPlanAssignments,
  organizationEffectiveQuotas,
  organizationPlanPrice,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { deriveOrganizationFeatureState, EntitlementStatus, FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import { AssignPlanSheet, RecordCommercialTermForm } from '../forms';

export const dynamic = 'force-dynamic';

export default async function Commercial({ params }: PageProps<'/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/commercial'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await params;
  await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect(platformHref(goldId, 'organizations'));

  const [terms, states, products, plans, basePlan, addons, resolvedFeatures, quotas, agreements, assignmentHistory] = await Promise.all([
    listOrganizationTerms(db, { organizationId }),
    moduleCommercialState(db, { organizationId }),
    listProducts(db),
    listPlans(db),
    currentPlanAssignment(db, { organizationId }),
    currentAddonAssignments(db, { organizationId }),
    organizationResolvedFeatureStates(db, { organizationId }),
    organizationEffectiveQuotas(db, { organizationId }),
    listOrganizationPlanAgreements(db, { organizationId }),
    listOrganizationPlanAssignments(db, { organizationId }),
  ]);

  const [catalogProducts, catalogModules, catalogFeatures, standardPrice] = await Promise.all([
    listCatalogProducts(db),
    listCatalogModules(db),
    listCatalogFeatures(db),
    basePlan ? organizationPlanPrice(db, { organizationId, planId: basePlan.planId }) : Promise.resolve(null),
  ]);

  const basePlanDefinition = basePlan ? await getPlanById(db, basePlan.planId) : null;
  const addonDefinitions = await Promise.all(addons.map((a) => getPlanById(db, a.planId)));

  const moduleById = new Map(catalogModules.map((m) => [m.id, m]));
  const productById = new Map(catalogProducts.map((p) => [p.id, p]));
  const resolvedByFeature = new Map(resolvedFeatures.map((r) => [r.featureId, r]));

  return (
    <AppPage>
      <TenantWorkspaceHeader goldId={goldId} id={organizationId} name={tenant.name} currency={tenant.currency} />

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardDescription>Current Plan</CardDescription>
              <CardTitle className="text-xl">{basePlanDefinition?.label ?? 'No standard Plan'}</CardTitle>
            </div>
            <AssignPlanSheet organizationId={organizationId} plans={plans.map((p) => ({ value: p.id, label: `${p.label} (${p.kind})` }))} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6 text-sm">
          {basePlan ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">Effective</p>
                <p>
                  {basePlan.periodStart} – {basePlan.periodEnd === '9999-12-31' ? 'ongoing' : basePlan.periodEnd}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Standard price</p>
                <p>{standardPrice ? `${formatMoney(standardPrice.amountMinor, standardPrice.currency)} (${standardPrice.source})` : 'Not priced'}</p>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              This organization does not currently have a standard Plan. Existing purchased terms still apply.
            </p>
          )}
          {addonDefinitions.length > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground">Add-ons</p>
              <p>{addonDefinitions.map((a) => a?.label).filter(Boolean).join(', ')}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs defaultValue="products" className="mt-8">
        <TabsList>
          <TabsTrigger value="products">Products &amp; Features</TabsTrigger>
          <TabsTrigger value="quotas">Quotas</TabsTrigger>
          <TabsTrigger value="overrides">Overrides / Agreement</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <ul className="flex flex-col divide-y divide-border">
            {catalogFeatures.map((feature) => {
              const resolved = resolvedByFeature.get(feature.id);
              const catalogModule = moduleById.get(feature.moduleId);
              const product = catalogModule ? productById.get(catalogModule.productId) : undefined;
              return (
                <li key={feature.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-sm font-medium">{feature.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {product?.label} · {catalogModule?.label}
                    </p>
                    <FeatureStatusBadges feature={feature} />
                  </div>
                  {resolved ? <EntitlementStatus state={deriveOrganizationFeatureState(resolved)} /> : null}
                </li>
              );
            })}
          </ul>
        </TabsContent>

        <TabsContent value="quotas" className="mt-4">
          {quotas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No structured quotas resolve for this organization yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {quotas.map((quota) => (
                <div key={`${quota.planKey}-${quota.allowanceKey}`} className="rounded border border-border p-3 text-sm">
                  <p className="font-medium">{quota.label}</p>
                  <p className="mt-1">
                    {quota.includedQuantity.toLocaleString()} {quota.unit}
                    {quota.period !== 'none' ? ` / ${quota.period}` : ''}
                  </p>
                  {quota.overridden ? <Badge tone="accent">Organization override</Badge> : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="overrides" className="mt-4">
          <SectionHeading>Negotiated agreements</SectionHeading>
          {agreements.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No negotiated price. This organization pays each Plan&rsquo;s standard price.</p>
          ) : (
            <DataTable
              rows={agreements}
              rowKey={(row) => row.id}
              empty="No agreements."
              columns={[
                { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => plans.find((p) => p.id === row.planId)?.label ?? row.planId },
                { key: 'amount', header: 'Agreed price', cell: (row) => formatMoney(row.amountMinor, row.currency) },
                { key: 'effective', header: 'Effective from', cell: (row) => new Date(row.effectiveFrom).toLocaleDateString() },
              ]}
            />
          )}

          <SectionHeading className="mt-8">Legacy per-product terms</SectionHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            Recorded before Plans existed, or as a standalone custom agreement outside any Plan. Never rewritten by a Plan assignment.
          </p>
          <div className="mt-3">
            <DataTable
              rows={terms}
              rowKey={(row) => row.id}
              empty="No legacy commercial terms."
              columns={[
                { key: 'product', header: 'Product', emphasis: 'primary', cell: (row) => row.productKey },
                { key: 'period', header: 'Period', cell: (row) => `${row.periodStart} – ${row.periodEnd}` },
                { key: 'price', header: 'Agreed price', cell: (row) => (row.currency ? formatMoney(row.priceMinor, row.currency) : 'No charge') },
              ]}
            />
          </div>
          <div className="mt-4 max-w-sm">
            <RecordCommercialTermForm
              organizationId={organizationId}
              products={products.map((product) => ({ value: product.key, label: product.label }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <SectionHeading>Plan assignment history</SectionHeading>
          <div className="mt-3">
            <DataTable
              rows={assignmentHistory}
              rowKey={(row) => row.id}
              empty="No Plan has ever been assigned to this organization."
              columns={[
                { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => plans.find((p) => p.id === row.planId)?.label ?? row.planId },
                { key: 'kind', header: 'Kind', cell: (row) => row.planKind },
                { key: 'period', header: 'Period', cell: (row) => `${row.periodStart} – ${row.periodEnd === '9999-12-31' ? 'ongoing' : row.periodEnd}` },
              ]}
            />
          </div>

          <SectionHeading className="mt-8">Legacy module entitlement</SectionHeading>
          <p className="mt-1 text-sm text-muted-foreground">Wanted∩paid, computed the same way it was before Plans existed.</p>
          <div className="mt-3">
            <DataTable
              rows={states}
              rowKey={(row) => row.moduleKey}
              empty="No optional module state."
              columns={[
                { key: 'module', header: 'Module', emphasis: 'primary', cell: (row) => row.moduleKey },
                { key: 'wanted', header: 'Wanted', cell: (row) => String(row.wanted) },
                { key: 'paid', header: 'Paid', cell: (row) => String(row.paid) },
              ]}
            />
          </div>
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}
