import Link from 'next/link';
import { EmptyState, SectionHeader } from '@/components/surfaces/section';
import { InfoPopover } from '@/components/controls/info-popover';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@gold/ui/components/accordion';
import type { PlanSwitchesModel } from '@/lib/application/finance/plan-switches';
import { FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import {
  EditPlanSwitchesSheet,
  FeatureOverrideControl,
  ModuleGrantToggle,
  ProductGrantToggle,
  QuotaSheet,
  RemoveQuotaButton,
  type PlanTarget,
} from '@/features/finance/catalog/plan-switch-forms';

/**
 * What a GildOps plan switches on, edited on the plan's own item in Catalog & Pricing (ADR-057).
 * Drawn only for members who also hold the Product Registry permission (`platform.catalogue`);
 * everybody else sees the read-only summary. The switch list is the platform's entitlement record,
 * so the database checks that permission again on every change.
 */
export function PlanSwitchesEditor({ target, model }: { target: PlanTarget; model: PlanSwitchesModel }) {
  const { plan, products, productGrantSet, moduleGrantSet, featureOverrideByFeature, entitled, quotas, modulesByProduct, featuresByModule } = model;
  return (
    <section aria-labelledby="plan-switches-heading">
      <SectionHeader
        id="plan-switches-heading"
        title="What it switches on"
        action={<div className="flex items-center gap-2">{!plan.billable ? <Badge>Not billed</Badge> : null}<EditPlanSwitchesSheet target={target} plan={plan} /></div>}
      />
      <Tabs defaultValue="includes" className="mt-3">
        <TabsList>
          <TabsTrigger value="includes">Features</TabsTrigger>
          <TabsTrigger value="allowances">Allowances</TabsTrigger>
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
                      <ProductGrantToggle target={target} productKey={product.key} granted={productGranted} />
                    </div>
                    {productModules.map((module) => {
                      const moduleGranted = moduleGrantSet.has(module.id);
                      const features = featuresByModule.get(module.id) ?? [];
                      return (
                        <div key={module.id} className="mb-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{module.label}</p>
                            {!productGranted ? <ModuleGrantToggle target={target} moduleId={module.id} granted={moduleGranted} /> : null}
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
                                    <FeatureOverrideControl target={target} featureId={feature.id} override={override} />
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
            <QuotaSheet target={target} />
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
                    <QuotaSheet target={target} quota={quota} />
                    <RemoveQuotaButton target={target} allowanceKey={quota.allowanceKey} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

/** The businesses holding a plan, each opening its subscription. Drawn for members who may read subscriptions. */
export function PlanSubscribers({ organizationId, model }: { organizationId: string; model: PlanSwitchesModel }) {
  return (
    <section aria-labelledby="plan-subscribers-heading">
      <SectionHeader id="plan-subscribers-heading" title={<>Subscribers <span className="text-sm font-normal text-muted">({model.assignedOrganizations.length})</span></>} />
      <div className="mt-3">
        <DataTable
          rows={model.assignedOrganizations}
          rowKey={({ assignment }) => assignment.id}
          empty="No business holds this plan."
          columns={[
            {
              key: 'business',
              header: 'Business',
              emphasis: 'primary',
              cell: ({ assignment, tenant, subscriptionId }) => (subscriptionId ? (
                <Link href={`/organizations/${organizationId}/finance/subscriptions/${subscriptionId}`} className="font-medium underline-offset-4 hover:underline">
                  {tenant?.name ?? assignment.organizationId}
                </Link>
              ) : (tenant?.name ?? assignment.organizationId)),
            },
            { key: 'period', header: 'Held', cell: ({ assignment }) => <>{assignment.periodStart} – {assignment.periodEnd === '9999-12-31' ? 'ongoing' : assignment.periodEnd}</> },
          ]}
        />
      </div>
    </section>
  );
}
