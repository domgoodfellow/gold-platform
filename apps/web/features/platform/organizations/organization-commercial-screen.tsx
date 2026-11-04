import { platformHref } from '@/lib/platform-navigation';
import { AppPage } from '@/components/layout/app-page';
import { GroupHeading, SectionHeading } from '@/components/surfaces/section';
import { DataTable } from '@/components/display/table';
import { AllowanceMeter } from '@/features/catalogue/allowance-meter';
import { Badge } from '@/components/display/data';
import { Card, CardContent, CardHeader, CardTitle } from '@gold/ui/components/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import type { ComponentPrice, OrganizationCommercialModel } from '@/lib/application/platform/organization-commercial';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { EntitlementStatus, FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import { AssignPlanSheet, ManageAddonsSheet, RecordCommercialTermForm, RecordPlanAgreementSheet, RecordQuotaOverrideSheet } from '@/features/platform/organizations/forms';
import { ButtonLink } from '@/components/controls/button';
import type { OrganizationEconomicsModel } from '@/lib/application/platform/economics-overview';

const OVERAGE_BEHAVIOR_LABEL: Record<string, string> = {
  metered: 'Metered',
  hard_limit: 'Hard limit',
  soft_limit: 'Soft limit',
  unmetered: 'Unmetered',
  not_applicable: 'Not applicable',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function formatPeriod(periodStart: string, periodEnd: string): string {
  return `${periodStart} – ${periodEnd === '9999-12-31' ? 'ongoing' : periodEnd}`;
}

/** `null` is a fact — "not priced" or "currency mismatch" — never rendered as if it were zero. */
function PriceCell({ price }: { price: { amountMinor: number; currency: string } | null }) {
  return <>{price ? formatMoney(price.amountMinor, price.currency) : <span className="text-muted-foreground">Unknown / incomplete</span>}</>;
}

/** Standard / Agreement / Effective, for one Plan or Add-on — the one place this triple renders, reused by the summary card and the recurring breakdown. */
function PriceTripleRows({ component }: { component: ComponentPrice }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Standard</dt>
      <dd className="text-right tabular-nums"><PriceCell price={component.standard} /></dd>
      {component.agreement ? (
        <>
          <dt className="text-muted-foreground">Agreement</dt>
          <dd className="text-right tabular-nums">{formatMoney(component.agreement.amountMinor, component.agreement.currency)}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Effective</dt>
      <dd className="text-right font-medium tabular-nums"><PriceCell price={component.effective} /></dd>
    </dl>
  );
}

export function OrganizationCommercialScreen({
  goldId,
  organizationId,
  model,
  canManageCommercial,
  economics,
}: {
  goldId: string;
  organizationId: string;
  model: OrganizationCommercialModel;
  canManageCommercial: boolean;
  /** Null when the caller lacks `platform.commercial` — the Economics tab stays off rather than showing an empty one (the navigation rules' own discipline, one layer down). */
  economics: OrganizationEconomicsModel | null;
}) {
  const {
    tenant, basePlan, addons, pricing, recurringComponents, recurringTotal, features, allowances,
    agreements, assignmentHistory, quotaOverrideHistory, legacy, states, products, plans,
  } = model;

  const planOptions = plans.filter((plan) => plan.kind === 'plan').map((plan) => ({ value: plan.id, label: plan.label }));
  const addonOptions = plans.filter((plan) => plan.kind === 'addon').map((plan) => ({ value: plan.id, label: plan.label }));
  const currentAgreement = pricing.agreement;

  return (
    <AppPage>
      <TenantWorkspaceHeader goldId={goldId} id={organizationId} name={tenant.name} currency={tenant.currency} />

      {/* Commercial Summary: what this organization has bought, and what it costs right now. */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">Base Plan: {basePlan.plan?.label ?? 'No standard Plan'}</CardTitle>
              {basePlan.assignment ? (
                <p className="mt-1 text-xs text-muted-foreground">Effective {formatPeriod(basePlan.assignment.periodStart, basePlan.assignment.periodEnd)}</p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Existing purchased terms still apply — see Legacy, below.</p>
              )}
              {legacy.hasLegacyTerms ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  This organization also has legacy per-product terms outside the Plan model — see Legacy, below.
                </p>
              ) : null}
            </div>
            {canManageCommercial ? (
              <div className="flex flex-wrap gap-2">
                <AssignPlanSheet organizationId={organizationId} plans={planOptions} />
                <ManageAddonsSheet organizationId={organizationId} addons={addonOptions} />
                {basePlan.assignment && basePlan.plan ? (
                  <RecordPlanAgreementSheet organizationId={organizationId} planId={basePlan.assignment.planId} planLabel={basePlan.plan.label} currency={tenant.currency} />
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {basePlan.plan ? (
            <div className="max-w-xs">
              <PriceTripleRows component={{ planId: basePlan.plan.id, planKey: basePlan.plan.key, label: basePlan.plan.label, kind: 'plan', ...pricing }} />
            </div>
          ) : null}

          {addons.length > 0 ? (
            <div>
              <GroupHeading>Add-ons</GroupHeading>
              <ul className="mt-2 flex flex-col divide-y divide-border">
                {recurringComponents
                  .filter((component) => component.kind === 'addon')
                  .map((component) => (
                    <li key={component.planId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>{component.label}</span>
                      <span className="tabular-nums"><PriceCell price={component.effective} /></span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-medium">
            <span>Recurring</span>
            <span className="tabular-nums">{recurringTotal ? formatMoney(recurringTotal.amountMinor, recurringTotal.currency) : 'Unknown / incomplete'}</span>
          </div>
          {!recurringTotal && recurringComponents.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Not every component is priced in one currency, so the total above is not shown as zero — it is unknown.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Tabs defaultValue="entitlements" className="mt-8">
        <TabsList>
          <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
          <TabsTrigger value="allowances">Allowances</TabsTrigger>
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
          {economics ? <TabsTrigger value="economics">Economics</TabsTrigger> : null}
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="legacy">Legacy</TabsTrigger>
        </TabsList>

        {economics ? (
          <TabsContent value="economics" className="mt-4">
            <p className="text-xs text-muted-foreground">
              {new Date(economics.period.start).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })} ·
              amounts in {economics.revenue.reportingCurrency}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <EconomicsStat label="Customer obligation" value={formatMoney(economics.revenue.customerObligationMinor, economics.revenue.reportingCurrency)} />
              <EconomicsStat label="Known cost-to-serve" value={formatMoney(Math.round(economics.cost.attributableKnownCogsMicros / 1_000_000), economics.cost.reportingCurrency)} />
              <EconomicsStat label="Known contribution" value={formatMoney(economics.revenue.knownContributionMinor, economics.revenue.reportingCurrency)} />
              <EconomicsStat
                label="Cost coverage"
                value={`${(economics.revenue.costCoverage * 100).toFixed(0)}%`}
                tone={economics.revenue.costCoverage < 1 ? 'danger' : undefined}
              />
            </div>
            {economics.storage ? (
              <div className="mt-4 border-t border-border pt-3">
                <AllowanceMeter state={economics.storage} className="py-0" />
              </div>
            ) : null}
            <ButtonLink
              href={platformHref(goldId, `economics/${organizationId}`)}
              tone="text"
              size="small"
              className="mt-3"
            >
              Full economics detail →
            </ButtonLink>
          </TabsContent>
        ) : null}

        <TabsContent value="entitlements" className="mt-4 flex flex-col gap-6">
          {features.length === 0 ? (
            <p className="text-sm text-muted-foreground">No catalogue Features are registered.</p>
          ) : (
            features.map(({ product, modules }) => (
              <div key={product.id}>
                <SectionHeading>{product.label}</SectionHeading>
                <div className="mt-2 flex flex-col gap-4">
                  {modules.map(({ module, features: moduleFeatures }) => (
                    <div key={module.id}>
                      <GroupHeading>{module.label}</GroupHeading>
                      <ul className="mt-1 flex flex-col divide-y divide-border">
                        {moduleFeatures.map(({ feature, resolved }) => (
                          <li key={feature.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <div>
                              <p className="text-sm font-medium">{feature.label}</p>
                              <FeatureStatusBadges feature={feature} />
                            </div>
                            <div className="flex items-center gap-1.5">
                              {resolved?.readiness === 'setup_required' ? <Badge>Setup required</Badge> : null}
                              {resolved ? <EntitlementStatus state={resolved} /> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="allowances" className="mt-4">
          {allowances.length === 0 ? (
            <p className="text-sm text-muted-foreground">No structured allowances resolve for this organization yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {allowances.map((allowance) => (
                <div key={`${allowance.sourcePlanKey}-${allowance.allowanceKey}`} className="rounded border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{allowance.label}</p>
                    {allowance.overridden ? <Badge tone="accent">Organization override</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{allowance.sourcePlanLabel}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {allowance.overridden ? (
                      <>
                        <dt className="text-xs text-muted-foreground">Plan default</dt>
                        <dd className="text-right text-xs tabular-nums">
                          {allowance.included.planDefault === null ? '—' : allowance.included.planDefault.toLocaleString()}
                        </dd>
                        <dt className="text-xs text-muted-foreground">Override</dt>
                        <dd className="text-right text-xs tabular-nums">{allowance.included.override?.toLocaleString()}</dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">Effective</dt>
                    <dd className="text-right tabular-nums">
                      {allowance.included.effective.toLocaleString()} {allowance.unit}
                      {allowance.period !== 'none' ? ` / ${allowance.period}` : ''}
                    </dd>
                    <dt className="text-xs text-muted-foreground">Hard limit</dt>
                    <dd className="text-right text-xs tabular-nums">{allowance.hardLimit === null ? 'None' : allowance.hardLimit.toLocaleString()}</dd>
                    <dt className="text-xs text-muted-foreground">Overage</dt>
                    <dd className="text-right text-xs">{allowance.overageBehavior ? OVERAGE_BEHAVIOR_LABEL[allowance.overageBehavior] : '—'}</dd>
                  </dl>
                  {allowance.runtime ? (
                    <div className="mt-2 border-t border-border pt-1">
                      <AllowanceMeter state={allowance.runtime} className="py-0" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {canManageCommercial && basePlan.assignment ? (
            <div className="mt-4">
              <RecordQuotaOverrideSheet
                organizationId={organizationId}
                planId={basePlan.assignment.planId}
                quotas={allowances.map((allowance) => ({ allowanceKey: allowance.allowanceKey, label: allowance.label, includedQuantity: allowance.included.effective }))}
              />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="agreements" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading>Current negotiated price</SectionHeading>
            {basePlan.assignment && basePlan.plan ? (
              <ButtonLink href={`${platformHref(goldId, 'package-economics')}?source=organization_agreement&id=${organizationId}`} tone="secondary" size="small">
                Simulate agreement
              </ButtonLink>
            ) : null}
          </div>
          {currentAgreement && basePlan.plan ? (
            <div className="mt-3 max-w-sm rounded border border-border p-3 text-sm">
              <p className="font-medium">{basePlan.plan.label}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Standard</dt>
                <dd className="text-right tabular-nums"><PriceCell price={pricing.standard} /></dd>
                <dt className="text-muted-foreground">Agreement</dt>
                <dd className="text-right tabular-nums">{formatMoney(currentAgreement.amountMinor, currentAgreement.currency)}</dd>
                <dt className="text-muted-foreground">Effective from</dt>
                <dd className="text-right">{formatDate(currentAgreement.effectiveFrom)}</dd>
                <dt className="text-muted-foreground">Until</dt>
                <dd className="text-right">{currentAgreement.effectiveTo ? formatDate(currentAgreement.effectiveTo) : 'Open-ended'}</dd>
              </dl>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No negotiated price. This organization pays each Plan&rsquo;s standard price.</p>
          )}

          <SectionHeading className="mt-8">Agreement history</SectionHeading>
          <div className="mt-3">
            <DataTable
              rows={agreements}
              rowKey={(row) => row.id}
              empty="No agreements."
              columns={[
                { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => plans.find((p) => p.id === row.planId)?.label ?? row.planId },
                { key: 'amount', header: 'Agreed price', cell: (row) => formatMoney(row.amountMinor, row.currency) },
                { key: 'effective', header: 'Effective window', cell: (row) => `${formatDate(row.effectiveFrom)} – ${row.effectiveTo ? formatDate(row.effectiveTo) : 'Open-ended'}` },
              ]}
            />
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4 flex flex-col gap-8">
          <div>
            <SectionHeading>Base Plan assignments</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={assignmentHistory.filter((row) => row.planKind === 'plan')}
                rowKey={(row) => row.id}
                empty="No base Plan has ever been assigned to this organization."
                columns={[
                  { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => plans.find((p) => p.id === row.planId)?.label ?? row.planId },
                  { key: 'period', header: 'Period', cell: (row) => formatPeriod(row.periodStart, row.periodEnd) },
                ]}
              />
            </div>
          </div>

          <div>
            <SectionHeading>Add-on assignments</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={assignmentHistory.filter((row) => row.planKind === 'addon')}
                rowKey={(row) => row.id}
                empty="No Add-on has ever been assigned to this organization."
                columns={[
                  { key: 'plan', header: 'Add-on', emphasis: 'primary', cell: (row) => plans.find((p) => p.id === row.planId)?.label ?? row.planId },
                  { key: 'period', header: 'Period', cell: (row) => formatPeriod(row.periodStart, row.periodEnd) },
                ]}
              />
            </div>
          </div>

          <div>
            <SectionHeading>Agreement changes</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={agreements}
                rowKey={(row) => row.id}
                empty="No agreement has ever been recorded."
                columns={[
                  { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => plans.find((p) => p.id === row.planId)?.label ?? row.planId },
                  { key: 'amount', header: 'Agreed price', cell: (row) => formatMoney(row.amountMinor, row.currency) },
                  { key: 'recorded', header: 'Recorded', cell: (row) => formatDate(row.recordedAt) },
                ]}
              />
            </div>
          </div>

          <div>
            <SectionHeading>Allowance overrides</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={quotaOverrideHistory}
                rowKey={(row) => row.id}
                empty="No allowance has ever been overridden for this organization."
                columns={[
                  { key: 'allowance', header: 'Allowance', emphasis: 'primary', cell: (row) => row.allowanceKey },
                  { key: 'quantity', header: 'Included quantity', cell: (row) => row.includedQuantity.toLocaleString() },
                  { key: 'from', header: 'Effective from', cell: (row) => formatDate(row.effectiveFrom) },
                ]}
              />
            </div>
          </div>

          <div>
            <SectionHeading>Legacy module entitlement</SectionHeading>
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
          </div>
        </TabsContent>

        <TabsContent value="legacy" className="mt-4">
          <SectionHeading>Legacy per-product terms</SectionHeading>
          <div className="mt-3">
            <DataTable
              rows={legacy.terms}
              rowKey={(row) => row.id}
              empty="No legacy commercial terms."
              columns={[
                { key: 'product', header: 'Product', emphasis: 'primary', cell: (row) => row.productKey },
                { key: 'period', header: 'Period', cell: (row) => `${row.periodStart} – ${row.periodEnd}` },
                { key: 'price', header: 'Agreed price', cell: (row) => (row.currency ? formatMoney(row.priceMinor, row.currency) : 'No charge') },
              ]}
            />
          </div>
          {canManageCommercial ? (
            <div className="mt-6 max-w-sm rounded border border-dashed border-border p-4">
              <GroupHeading>Record a standalone legacy term</GroupHeading>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                Only for a product this organization bought outside the Plan/Add-on model. Prefer Change Plan or
                Manage Add-ons, above, for anything a Plan can express.
              </p>
              <RecordCommercialTermForm organizationId={organizationId} products={products.map((product) => ({ value: product.key, label: product.label }))} />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}

function EconomicsStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}
