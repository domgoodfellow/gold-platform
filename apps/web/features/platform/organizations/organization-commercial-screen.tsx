import { platformHref } from '@/lib/platform-navigation';
import { AppPage } from '@/components/layout/app-page';
import { SectionHeading } from '@/components/surfaces/section';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import type { OrganizationCommercialModel } from '@/lib/application/platform/organization-commercial';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { deriveOrganizationFeatureState, EntitlementStatus, FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import { AssignPlanSheet, RecordCommercialTermForm, RecordPlanAgreementSheet, RecordQuotaOverrideSheet } from '@/features/platform/organizations/forms';
import { ButtonLink } from '@/components/controls/button';

export function OrganizationCommercialScreen({ goldId, organizationId, model }: { goldId: string; organizationId: string; model: OrganizationCommercialModel }) {
  const { tenant, terms, states, products, plans, basePlan, quotas, agreements,
    assignmentHistory, catalogFeatures, standardPrice, basePlanDefinition, addonDefinitions, moduleById,
    productById, resolvedByFeature } = model;

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
          <div className="flex flex-wrap items-center justify-between gap-3"><SectionHeading>Negotiated agreements</SectionHeading>{basePlan && basePlanDefinition ? <div className="flex gap-2"><ButtonLink href={`${platformHref(goldId, 'package-economics')}?source=organization_agreement&id=${organizationId}`} tone="secondary" size="small">Simulate agreement</ButtonLink><RecordPlanAgreementSheet organizationId={organizationId} planId={basePlan.planId} planLabel={basePlanDefinition.label} currency={tenant.currency} /></div> : null}</div>
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
                { key: 'effective', header: 'Effective window', cell: (row) => `${new Date(row.effectiveFrom).toLocaleDateString()} – ${row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString() : 'Open-ended'}` },
              ]}
            />
          )}
          {basePlan ? <div className="mt-4"><RecordQuotaOverrideSheet organizationId={organizationId} planId={basePlan.planId} quotas={quotas.map((quota) => ({ allowanceKey: quota.allowanceKey, label: quota.label, includedQuantity: quota.includedQuantity }))} /></div> : null}

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
