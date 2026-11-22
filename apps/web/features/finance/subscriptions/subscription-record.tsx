import { AppPage } from '@/components/layout/app-page';
import { RecordHeader } from '@/components/headers/record-header';
import { GroupHeading, SectionHeading } from '@/components/surfaces/section';
import { DataTable } from '@/components/display/table';
import { AllowanceMeter } from '@/features/catalogue/allowance-meter';
import { Badge } from '@/components/display/data';
import { Card, CardContent, CardHeader, CardTitle } from '@gold/ui/components/card';
import { Card as SurfaceCard } from '@/components/surfaces/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { ButtonLink } from '@/components/controls/button';
import type { ComponentPrice, SubscriptionModel } from '@/lib/application/finance/subscriptions';
import type { OrganizationEconomicsModel } from '@/lib/application/finance/cost-to-serve';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { describeServiceAccess } from '@/lib/domain/platform-billing/service-access';
import { describeReconciliationIssue, RECONCILIATION_STATE_LABEL } from '@/lib/domain/platform-billing/reconciliation';
import { EntitlementStatus, FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import { AddAddonSheet, AgreePriceSheet, ChangePlanSheet, OverrideAllowanceSheet, PrepareAgreedPriceButton, RecordTermForm } from '@/features/finance/subscriptions/subscription-forms';

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
  return <>{price ? formatMoney(price.amountMinor, price.currency) : <span className="text-muted-foreground">Unknown</span>}</>;
}

/** List / agreed / in force, for one plan or add-on — the one place this triple renders. */
function PriceRows({ component }: { component: ComponentPrice }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">List price</dt>
      <dd className="text-right tabular-nums"><PriceCell price={component.standard} /></dd>
      {component.agreement ? (
        <>
          <dt className="text-muted-foreground">Agreed</dt>
          <dd className="text-right tabular-nums">{formatMoney(component.agreement.amountMinor, component.agreement.currency)}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">In force</dt>
      <dd className="text-right font-medium tabular-nums"><PriceCell price={component.effective} /></dd>
    </dl>
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

/**
 * One business's subscription in GildOps' Finance (ADR-057): what it subscribes to and pays, what
 * that switches on, what the billing provider holds, and — for members who may see costs — what it
 * costs to serve. Changes take `subscription.manage`; each is a new effective-dated record.
 */
export function SubscriptionRecord({
  organizationId,
  subscriberId,
  model,
  mayManage,
  economics,
  links,
}: {
  /** GildOps' organization: the seller whose Finance this is. */
  organizationId: string;
  /** The business this subscription serves. */
  subscriberId: string;
  model: SubscriptionModel;
  mayManage: boolean;
  /** Null without `cost.read`: the Economics tab is not drawn rather than drawn empty. */
  economics: OrganizationEconomicsModel | null;
  /** The same business in GildOps' CRM and in Administration, offered only to members who may open them. */
  links: { customer?: string; administration?: string };
}) {
  const {
    tenant, basePlan, addons, pricing, recurringComponents, recurringTotal, features, allowances,
    agreements, assignmentHistory, quotaOverrideHistory, legacy, states, products, plans, billing, access,
  } = model;
  const target = { organizationId, subscriberId };
  const financeHref = `/organizations/${organizationId}/finance`;
  const planOptions = plans.filter((plan) => plan.kind === 'plan').map((plan) => ({ value: plan.id, label: plan.label }));
  const addonOptions = plans.filter((plan) => plan.kind === 'addon').map((plan) => ({ value: plan.id, label: plan.label }));
  const planLabel = (planId: string) => plans.find((plan) => plan.id === planId)?.label ?? planId;
  const currentAgreement = pricing.agreement;

  return (
    <AppPage>
      <RecordHeader
        title={tenant.name}
        crumbs={[
          { label: 'Finance', href: financeHref },
          { label: 'Subscriptions', href: `${financeHref}/subscriptions` },
          { label: tenant.name },
        ]}
        summary={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={access.permitted ? 'success' : 'danger'}>{access.permitted ? 'Service available' : 'Service locked'}</Badge>
            <span>{describeServiceAccess(access)}</span>
          </span>
        }
        actions={links.customer || links.administration ? (
          <div className="flex flex-wrap gap-2">
            {links.customer ? <ButtonLink href={links.customer} tone="secondary" size="small">Customer</ButtonLink> : null}
            {links.administration ? <ButtonLink href={links.administration} tone="secondary" size="small">Business in Administration</ButtonLink> : null}
          </div>
        ) : undefined}
      />

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">{basePlan.plan?.label ?? 'No plan'}</CardTitle>
              {basePlan.assignment ? (
                <p className="mt-1 text-xs text-muted-foreground">{formatPeriod(basePlan.assignment.periodStart, basePlan.assignment.periodEnd)}</p>
              ) : legacy.hasLegacyTerms ? (
                <p className="mt-1 text-sm text-muted-foreground">Served on per-product terms.</p>
              ) : null}
            </div>
            {mayManage ? (
              <div className="flex flex-wrap gap-2">
                <ChangePlanSheet target={target} plans={planOptions} />
                <AddAddonSheet target={target} addons={addonOptions} />
                {basePlan.assignment && basePlan.plan ? (
                  <AgreePriceSheet target={target} planId={basePlan.assignment.planId} planLabel={basePlan.plan.label} currency={tenant.currency} />
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {basePlan.plan ? (
            <div className="max-w-xs">
              <PriceRows component={{ planId: basePlan.plan.id, planKey: basePlan.plan.key, label: basePlan.plan.label, kind: 'plan', ...pricing }} />
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
            <span>Every month</span>
            <span className="tabular-nums">
              {recurringTotal
                ? formatMoney(recurringTotal.amountMinor, recurringTotal.currency)
                : recurringComponents.length > 0 ? 'Unknown: not every part is priced in one currency' : '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="entitlements" className="mt-8">
        <TabsList>
          <TabsTrigger value="entitlements">What it switches on</TabsTrigger>
          <TabsTrigger value="allowances">Allowances</TabsTrigger>
          <TabsTrigger value="agreements">Agreed prices</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          {economics ? <TabsTrigger value="economics">Economics</TabsTrigger> : null}
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
        </TabsList>

        <TabsContent value="entitlements" className="mt-4 flex flex-col gap-6">
          {features.length === 0 ? (
            <p className="text-sm text-muted-foreground">No features are registered.</p>
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
            <p className="text-sm text-muted-foreground">No allowances.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {allowances.map((allowance) => (
                <SurfaceCard key={`${allowance.sourcePlanKey}-${allowance.allowanceKey}`} variant="outlined" className="text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{allowance.label}</p>
                    {allowance.overridden ? <Badge tone="accent">Changed for this business</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{allowance.sourcePlanLabel}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {allowance.overridden ? (
                      <>
                        <dt className="text-xs text-muted-foreground">Plan includes</dt>
                        <dd className="text-right text-xs tabular-nums">
                          {allowance.included.planDefault === null ? '—' : allowance.included.planDefault.toLocaleString()}
                        </dd>
                        <dt className="text-xs text-muted-foreground">For this business</dt>
                        <dd className="text-right text-xs tabular-nums">{allowance.included.override?.toLocaleString()}</dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">In force</dt>
                    <dd className="text-right tabular-nums">
                      {allowance.included.effective.toLocaleString()} {allowance.unit}
                      {allowance.period !== 'none' ? ` / ${allowance.period}` : ''}
                    </dd>
                    <dt className="text-xs text-muted-foreground">Hard limit</dt>
                    <dd className="text-right text-xs tabular-nums">{allowance.hardLimit === null ? 'None' : allowance.hardLimit.toLocaleString()}</dd>
                    <dt className="text-xs text-muted-foreground">Beyond it</dt>
                    <dd className="text-right text-xs">{allowance.overageBehavior ? OVERAGE_BEHAVIOR_LABEL[allowance.overageBehavior] : '—'}</dd>
                  </dl>
                  {allowance.runtime ? (
                    <div className="mt-2 border-t border-border pt-1">
                      <AllowanceMeter state={allowance.runtime} className="py-0" />
                    </div>
                  ) : null}
                </SurfaceCard>
              ))}
            </div>
          )}
          {mayManage && basePlan.assignment ? (
            <div className="mt-4">
              <OverrideAllowanceSheet
                target={target}
                planId={basePlan.assignment.planId}
                allowances={allowances.map((allowance) => ({ allowanceKey: allowance.allowanceKey, label: allowance.label, includedQuantity: allowance.included.effective }))}
              />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="agreements" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading>Current agreed price</SectionHeading>
            {economics && basePlan.assignment && basePlan.plan ? (
              <ButtonLink href={`${financeHref}/economics/packages?source=organization_agreement&id=${subscriberId}`} tone="secondary" size="small">
                Simulate agreement
              </ButtonLink>
            ) : null}
          </div>
          {currentAgreement && basePlan.plan ? (
            <SurfaceCard variant="outlined" className="mt-3 max-w-sm text-sm">
              <p className="font-medium">{basePlan.plan.label}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">List price</dt>
                <dd className="text-right tabular-nums"><PriceCell price={pricing.standard} /></dd>
                <dt className="text-muted-foreground">Agreed</dt>
                <dd className="text-right tabular-nums">{formatMoney(currentAgreement.amountMinor, currentAgreement.currency)}</dd>
                <dt className="text-muted-foreground">From</dt>
                <dd className="text-right">{formatDate(currentAgreement.effectiveFrom)}</dd>
                <dt className="text-muted-foreground">Until</dt>
                <dd className="text-right">{currentAgreement.effectiveTo ? formatDate(currentAgreement.effectiveTo) : 'Open-ended'}</dd>
              </dl>
              {mayManage && basePlan.plan.billable ? <div className="mt-3"><PrepareAgreedPriceButton target={target} planId={basePlan.plan.id} /></div> : null}
            </SurfaceCard>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No agreed price: each plan&rsquo;s list price applies.</p>
          )}

          <SectionHeading className="mt-8">Agreed price history</SectionHeading>
          <div className="mt-3">
            <DataTable
              rows={agreements}
              rowKey={(row) => row.id}
              empty="No agreed prices."
              columns={[
                { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => planLabel(row.planId) },
                { key: 'amount', header: 'Agreed price', cell: (row) => formatMoney(row.amountMinor, row.currency) },
                { key: 'effective', header: 'In force', cell: (row) => `${formatDate(row.effectiveFrom)} – ${row.effectiveTo ? formatDate(row.effectiveTo) : 'Open-ended'}` },
              ]}
            />
          </div>
        </TabsContent>

        <TabsContent value="billing" className="mt-4 flex flex-col gap-6">
          {billing.subscription ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{billing.subscription.status.replace('_', ' ')}</dd></div>
              <div>
                <dt className="text-muted-foreground">Current period ends</dt>
                <dd className="font-medium">{billing.subscription.currentPeriodEnd ? formatDate(billing.subscription.currentPeriodEnd) : '—'}{billing.subscription.cancelAtPeriodEnd ? ' (canceling)' : ''}</dd>
              </div>
              <div><dt className="text-muted-foreground">Matches checkout</dt><dd className="font-medium">{RECONCILIATION_STATE_LABEL[billing.subscription.reconciliationState]}</dd></div>
              <div><dt className="text-muted-foreground">Environment</dt><dd className="font-medium">{billing.environment ?? '—'}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No billing-service subscription{billing.environment ? ` in ${billing.environment}` : ''}.</p>
          )}
          {billing.subscription && billing.subscription.reconciliationIssues.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {billing.subscription.reconciliationIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{describeReconciliationIssue(issue)}</li>)}
            </ul>
          ) : null}
          <div>
            <SectionHeading>Billing service items</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={billing.items}
                rowKey={(item) => item.id}
                empty="The billing service holds no items."
                columns={[
                  { key: 'item', header: 'Item', emphasis: 'primary', cell: (item) => (item.canonicalSource?.planId ? planLabel(item.canonicalSource.planId) : 'Price not matched to a plan') },
                  { key: 'price', header: 'Billing service price', cell: (item) => <span className="font-mono text-xs">{item.providerPriceReference}</span> },
                  { key: 'quantity', header: 'Quantity', numeric: true, cell: (item) => item.quantity ?? '—' },
                  { key: 'state', header: 'State', cell: (item) => <Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Active' : 'Removed'}</Badge> },
                ]}
              />
            </div>
          </div>
          <div>
            <SectionHeading>Deliveries</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={billing.events}
                rowKey={(event) => event.id}
                empty="No delivery for this business yet."
                columns={[
                  { key: 'type', header: 'Event', emphasis: 'primary', cell: (event) => <span className="font-mono text-xs">{event.eventType}</span> },
                  { key: 'received', header: 'Received', cell: (event) => new Date(event.receivedAt).toLocaleString() },
                  { key: 'applied', header: 'Applied', cell: (event) => (event.application === 'stale' ? 'Older than state held' : event.application === 'ambiguous' ? 'Conflicting, not applied' : event.application === 'applied' ? 'Applied' : 'Notice') },
                ]}
              />
            </div>
          </div>
        </TabsContent>

        {economics ? (
          <TabsContent value="economics" className="mt-4">
            <p className="text-xs text-muted-foreground">
              {new Date(economics.period.start).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · amounts in {economics.revenue.reportingCurrency}
            </p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <EconomicsStat label="Owed this month" value={formatMoney(economics.revenue.customerObligationMinor, economics.revenue.reportingCurrency)} />
              <EconomicsStat label="Known cost to serve" value={formatMoney(Math.round(economics.cost.attributableKnownCogsMicros / 1_000_000), economics.cost.reportingCurrency)} />
              <EconomicsStat label="Known contribution" value={formatMoney(economics.revenue.knownContributionMinor, economics.revenue.reportingCurrency)} />
              <EconomicsStat label="Cost coverage" value={`${(economics.revenue.costCoverage * 100).toFixed(0)}%`} tone={economics.revenue.costCoverage < 1 ? 'danger' : undefined} />
            </dl>
            {economics.storage ? (
              <div className="mt-4 border-t border-border pt-3">
                <AllowanceMeter state={economics.storage} className="py-0" />
              </div>
            ) : null}
            <ButtonLink href={`${financeHref}/economics/${subscriberId}`} tone="text" size="small" className="mt-3">
              Cost to serve
            </ButtonLink>
          </TabsContent>
        ) : null}

        <TabsContent value="history" className="mt-4 flex flex-col gap-8">
          <div>
            <SectionHeading>Plans</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={assignmentHistory.filter((row) => row.planKind === 'plan')}
                rowKey={(row) => row.id}
                empty="No plan has been recorded."
                columns={[
                  { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => planLabel(row.planId) },
                  { key: 'period', header: 'Period', cell: (row) => formatPeriod(row.periodStart, row.periodEnd) },
                ]}
              />
            </div>
          </div>
          <div>
            <SectionHeading>Add-ons</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={assignmentHistory.filter((row) => row.planKind === 'addon')}
                rowKey={(row) => row.id}
                empty="No add-on has been recorded."
                columns={[
                  { key: 'plan', header: 'Add-on', emphasis: 'primary', cell: (row) => planLabel(row.planId) },
                  { key: 'period', header: 'Period', cell: (row) => formatPeriod(row.periodStart, row.periodEnd) },
                ]}
              />
            </div>
          </div>
          <div>
            <SectionHeading>Agreed prices</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={agreements}
                rowKey={(row) => row.id}
                empty="No agreed price has been recorded."
                columns={[
                  { key: 'plan', header: 'Plan', emphasis: 'primary', cell: (row) => planLabel(row.planId) },
                  { key: 'amount', header: 'Agreed price', cell: (row) => formatMoney(row.amountMinor, row.currency) },
                  { key: 'recorded', header: 'Recorded', cell: (row) => formatDate(row.recordedAt) },
                ]}
              />
            </div>
          </div>
          <div>
            <SectionHeading>Allowance changes</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={quotaOverrideHistory}
                rowKey={(row) => row.id}
                empty="No allowance has been changed."
                columns={[
                  { key: 'allowance', header: 'Allowance', emphasis: 'primary', cell: (row) => row.allowanceKey },
                  { key: 'quantity', header: 'Included', cell: (row) => row.includedQuantity.toLocaleString() },
                  { key: 'from', header: 'From', cell: (row) => formatDate(row.effectiveFrom) },
                ]}
              />
            </div>
          </div>
          <div>
            <SectionHeading>Paid features</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={states}
                rowKey={(row) => row.moduleKey}
                empty="No optional feature recorded."
                columns={[
                  { key: 'module', header: 'Feature', emphasis: 'primary', cell: (row) => row.moduleKey },
                  { key: 'wanted', header: 'Wanted', cell: (row) => String(row.wanted) },
                  { key: 'paid', header: 'Paid', cell: (row) => String(row.paid) },
                ]}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="terms" className="mt-4">
          <SectionHeading>Per-product terms</SectionHeading>
          <div className="mt-3">
            <DataTable
              rows={legacy.terms}
              rowKey={(row) => row.id}
              empty="No per-product terms."
              columns={[
                { key: 'product', header: 'Product', emphasis: 'primary', cell: (row) => row.productKey },
                { key: 'period', header: 'Period', cell: (row) => `${row.periodStart} – ${row.periodEnd}` },
                { key: 'price', header: 'Agreed price', cell: (row) => (row.currency ? formatMoney(row.priceMinor, row.currency) : 'No charge') },
              ]}
            />
          </div>
          {mayManage ? (
            <div className="mt-6 max-w-sm">
              <GroupHeading>Record a per-product term</GroupHeading>
              <div className="mt-3">
                <RecordTermForm target={target} products={products.map((product) => ({ value: product.key, label: product.label }))} />
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}
