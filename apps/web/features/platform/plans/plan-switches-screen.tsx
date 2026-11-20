import Link from 'next/link';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import { RecordHeader } from '@/components/headers/record-header';
import { EmptyState } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { InfoPopover } from '@/components/controls/info-popover';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@gold/ui/components/accordion';
import type { PlanSwitchesModel } from '@/lib/application/platform/plan-switches';
import { FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import {
  EditPlanSwitchesSheet,
  FeatureOverrideControl,
  ModuleGrantToggle,
  ProductGrantToggle,
  QuotaSheet,
  RemoveQuotaButton,
} from '@/features/platform/plans/plan-forms';

/**
 * Product Registry → one plan (ADR-057): what it switches on and which businesses hold it. Its
 * name, description, prices and sale status are the recurring item in GildOps' Finance.
 */
export function PlanSwitchesScreen({ organizationId, model }: { organizationId: string; model: PlanSwitchesModel }) {
  const { plan, products, assignments, productGrantSet, moduleGrantSet, featureOverrideByFeature, entitled, quotas,
    modulesByProduct, featuresByModule, assignedOrganizations } = model;
  const financeHref = plan.priceBookItemId ? `/organizations/${organizationId}/finance/catalog/${plan.priceBookItemId}` : null;

  return (
    <>
      <RecordHeader
        title={plan.label}
        crumbs={[...platformAncestry(organizationId, 'plans'), { label: 'Plans', href: platformHref(organizationId, 'catalog/plans') }, { label: plan.label }]}
        actions={<div className="flex gap-2">{financeHref ? <ButtonLink href={financeHref} tone="secondary" size="small">Pricing in Finance</ButtonLink> : null}<EditPlanSwitchesSheet plan={plan} /></div>}
      />

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="accent">{plan.kind === 'plan' ? 'Plan' : 'Add-on'}</Badge>
        {!plan.billable ? <Badge>Not billed</Badge> : null}
        {plan.saleStatus !== 'active' ? <Badge>{plan.saleStatus === 'unlisted' ? 'Not offered' : 'Retired'}</Badge> : null}
        <Badge>{assignments.length} business{assignments.length === 1 ? '' : 'es'}</Badge>
      </div>

      <Tabs defaultValue="includes" className="mt-8">
        <TabsList>
          <TabsTrigger value="includes">What’s included</TabsTrigger>
          <TabsTrigger value="allowances">Allowances</TabsTrigger>
          <TabsTrigger value="businesses">Businesses</TabsTrigger>
        </TabsList>

        <TabsContent value="includes" className="mt-4">
          <div className="mb-3 flex justify-end">
            <InfoPopover label="How a product grant works">
              Including a whole product grants every feature under it that is available today — never a planned or partial one.
              Override a feature to add one the product grant leaves out, or to leave out one it would include.
            </InfoPopover>
          </div>
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
                            {!productGranted ? <ModuleGrantToggle planId={plan.id} planKey={plan.key} moduleId={module.id} granted={moduleGranted} /> : null}
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

        <TabsContent value="allowances" className="mt-4">
          <div className="mb-3 flex justify-end">
            <QuotaSheet planId={plan.id} planKey={plan.key} />
          </div>
          {quotas.length === 0 ? (
            <EmptyState>This plan has no allowances.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {quotas.map((quota) => (
                <li key={quota.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{quota.label}</p>
                    <p className="text-sm">
                      {quota.includedQuantity.toLocaleString()} {quota.unit}{quota.period !== 'none' ? ` / ${quota.period}` : ''}
                      <span className="text-muted"> · Limit {quota.hardLimit !== null ? quota.hardLimit.toLocaleString() : 'none'} · Beyond it: {quota.overageBehavior.replaceAll('_', ' ')}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <QuotaSheet planId={plan.id} planKey={plan.key} quota={quota} />
                    <RemoveQuotaButton planId={plan.id} planKey={plan.key} allowanceKey={quota.allowanceKey} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="businesses" className="mt-4">
          <DataTable
            rows={assignedOrganizations}
            rowKey={({ assignment }) => assignment.id}
            empty="No business holds this plan."
            columns={[
              {
                key: 'organization',
                header: 'Business',
                emphasis: 'primary',
                cell: ({ assignment, tenant }) => (
                  <Link href={platformHref(organizationId, `organizations/${assignment.organizationId}`)} className="underline underline-offset-4">
                    {tenant?.name ?? assignment.organizationId}
                  </Link>
                ),
              },
              {
                key: 'period',
                header: 'Held',
                cell: ({ assignment }) => <>{assignment.periodStart} – {assignment.periodEnd === '9999-12-31' ? 'ongoing' : assignment.periodEnd}</>,
              },
            ]}
          />
          <Hint className="mt-6 font-mono text-xs">key: {plan.key} · id: {plan.id}</Hint>
        </TabsContent>
      </Tabs>
    </>
  );
}
