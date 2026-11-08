import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import { RecordHeader } from '@/components/headers/record-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Badge } from '@/components/display/data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@gold/ui/components/accordion';
import type { CatalogFeature } from '@/lib/domain/catalogue/catalogue';
import type { CatalogFamilyModel } from '@/lib/application/platform/catalog-family';
import { FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import { EditModuleSheet, EditProductSheet, FeatureSheet } from '@/features/platform/catalog/family-forms';
import { Button } from '@/components/controls/button';

export function CatalogFamilyScreen({ goldId, model }: { goldId: string; model: CatalogFamilyModel }) {
  const { product, modules, featuresByModule, featureById, dependenciesByFeature, mappingsByFeature,
    grantingPlansByFeature, plansIncludingProduct, totalFeatures, byState, meteredCount, providerCapabilities } = model;

  // Every dependency edge touching a Feature in this Product.
  // requiredBy is the inverse edge — cheap to derive without a second query per feature.

  // Which Plans currently grant which Feature — computed once per Plan, not once per Feature.

  return (
    <>
      <RecordHeader
        title={product.label}
        crumbs={[...platformAncestry(goldId, 'products'), { label: 'Products', href: platformHref(goldId, 'catalog') }, { label: product.label }]}
        summary={product.description}
        actions={<EditProductSheet product={product} />}
      />

      <div className="flex flex-wrap gap-1.5">
        <Badge tone={product.lifecycle === 'stable' ? 'success' : 'neutral'}>{product.lifecycle}</Badge>
        <Badge>{product.saleStatus}</Badge>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Features" value={modules.length} />
        <StatCard label="Features" value={totalFeatures} />
        <StatCard label="Metered Features" value={meteredCount} />
        <StatCard label="Plans including this" value={plansIncludingProduct.length} />
      </div>

      <Tabs defaultValue="overview" className="mt-8">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="modules">Features</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Section className="border-t-0 pt-0">
            <SectionHeading>What is built</SectionHeading>
            <p className="mt-1 text-sm text-muted-foreground">
              {byState.available} available, {byState.partial} partial, {byState.planned} planned — out of {totalFeatures}{' '}
              catalogued Features.
            </p>
          </Section>
        </TabsContent>

        <TabsContent value="modules" className="mt-4">
          <Accordion type="multiple" defaultValue={modules.map((m) => m.id)}>
            {modules.map((module) => {
              const features = featuresByModule.get(module.id) ?? [];
              const counts = {
                available: features.filter((f) => f.implementationState === 'available').length,
                partial: features.filter((f) => f.implementationState === 'partial').length,
                planned: features.filter((f) => f.implementationState === 'planned').length,
              };
              return (
                <AccordionItem key={module.id} value={module.id}>
                  <AccordionTrigger>
                    <div>
                      <div className="font-medium">{module.label}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {module.description} · {counts.available} available, {counts.partial} partial, {counts.planned} planned
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="mb-3">
                      <EditModuleSheet module={module} familyKey={product.key} />
                    </div>
                    <ul className="flex flex-col divide-y divide-border">
                      {features.map((feature) => {
                        const deps = dependenciesByFeature.get(feature.id);
                        return (
                          <li key={feature.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{feature.label}</p>
                              {feature.description ? (
                                <p className="truncate text-xs text-muted-foreground">{feature.description}</p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-3">
                              <FeatureStatusBadges feature={feature} />
                              <FeatureSheet
                                feature={feature}
                                familyKey={product.key}
                                dependsOn={(deps?.requires ?? []).map((id) => featureById.get(id)).filter((f): f is CatalogFeature => !!f)}
                                requiredBy={(deps?.requiredBy ?? []).map((id) => featureById.get(id)).filter((f): f is CatalogFeature => !!f)}
                                runtimeMappings={mappingsByFeature.get(feature.id) ?? []}
                                grantingPlans={grantingPlansByFeature.get(feature.id) ?? []}
                                trigger={
                                  <Button type="button" tone="secondary" size="small">
                                    Inspect
                                  </Button>
                                }
                              />
                            </div>
                          </li>
                        );
                      })}
                      {features.length === 0 ? <li className="py-2 text-sm text-muted-foreground">No Features yet.</li> : null}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          {plansIncludingProduct.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Plan currently includes this Product.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {plansIncludingProduct.map((plan) => (
                <li key={plan.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{plan.label}</span>
                  <a href={platformHref(goldId, `plans/${plan.key}`)} className="underline underline-offset-4">
                    Open
                  </a>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="requirements" className="mt-4">
          <SectionHeading>Vendor services required</SectionHeading>
          {providerCapabilities.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No feature in this product needs a vendor yet.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {providerCapabilities.map((capability) => (
                <Badge key={capability}>{capability}</Badge>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
