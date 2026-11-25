import Link from 'next/link';
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
import type { SubscriptionLineView, SubscriptionModel } from '@/lib/application/finance/subscriptions';
import type { OrganizationEconomicsModel } from '@/lib/application/finance/cost-to-serve';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { formatMicros } from '@/lib/domain/pricing/money-input';
import { describeServiceAccess } from '@/lib/domain/platform-billing/service-access';
import { describeReconciliationIssue, RECONCILIATION_STATE_LABEL } from '@/lib/domain/platform-billing/reconciliation';
import { SUBSCRIPTION_STATUS_LABEL } from '@/lib/domain/subscriptions/subscriptions';
import { EntitlementStatus, FeatureStatusBadges } from '@/features/catalogue/feature-badges';
import { InvoiceStandingBadge } from '@/features/finance/collections/finance-tables';
import {
  AddAddonSheet,
  CancelSubscriptionSheet,
  ChangeItemSheet,
  EndAddonSheet,
  IssueInvoiceSheet,
  OverrideAllowanceSheet,
  PrepareAgreedPriceButton,
  RecordTermSheet,
  SetPriceSheet,
  UsagePriceSheet,
  type SubscriptionTarget,
} from '@/features/finance/subscriptions/subscription-forms';

const OVERAGE_BEHAVIOR_LABEL: Record<string, string> = {
  metered: 'Metered',
  hard_limit: 'Hard limit',
  soft_limit: 'Soft limit',
  unmetered: 'Unmetered',
  not_applicable: 'Not applicable',
};

const INTERVAL_WORD = { month: 'month', year: 'year' } as const;

/** A calendar date as people read it; dates here are days, so they are read in UTC. */
function day(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The last day of service for an exclusive end, or "Ongoing". */
function lastDay(endsOn: string | null): string {
  if (!endsOn) return 'Ongoing';
  const date = new Date(`${endsOn}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return day(date.toISOString());
}

function linePrice(line: SubscriptionLineView) {
  if (!line.price) return <span className="text-muted-foreground">Not priced</span>;
  const amount = formatMoney(line.price.amountMinor * line.quantity, line.price.currency);
  return <span className="inline-flex flex-wrap items-baseline gap-1">{amount}{line.price.billingInterval === 'one_time' ? <span className="text-muted-foreground">once</span> : null}{line.price.source === 'agreed' ? <Badge tone="accent">Agreed</Badge> : null}</span>;
}

function EconomicsStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}

/** The first day of the next period Finance would invoice, and that period's last day. */
function nextPeriod(model: SubscriptionModel): { start: string; end: string } | null {
  const { subscription } = model;
  const issued = model.invoices.filter(({ invoice }) => invoice.provider === null && invoice.periodEnd).map(({ invoice }) => invoice.periodEnd as string);
  const start = issued.length ? issued.sort().at(-1)! : subscription.startsOn;
  if (subscription.endsOn && start >= subscription.endsOn) return null;
  const end = new Date(`${start}T00:00:00Z`);
  if (subscription.billingInterval === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  const exclusive = subscription.endsOn && subscription.endsOn < end.toISOString().slice(0, 10) ? subscription.endsOn : end.toISOString().slice(0, 10);
  return { start, end: exclusive };
}

/**
 * One subscription in Finance (ADR-057): who it is with, what it is for and pays, its invoices and
 * its history. The same record in every business. Where its lines sell platform plans to a
 * provisioned business, it also shows what that business may use: what the plans switch on, its
 * allowances, agreed usage prices, the billing provider's copy and, for members who may see costs,
 * what serving it costs.
 */
export function SubscriptionRecord({
  organizationId,
  model,
  may,
  economics,
  links,
  today,
}: {
  organizationId: string;
  model: SubscriptionModel;
  may: { manage: boolean; issue: boolean };
  /** Null without `cost.read`: the Economics tab is not drawn rather than drawn empty. */
  economics: OrganizationEconomicsModel | null;
  /** The same customer in CRM and the business in Administration, offered only to members who may open them. */
  links: { customer?: string; administration?: string };
  today: string;
}) {
  const { subscription, status, customer, lines, amount, invoices, options, platform } = model;
  const target: SubscriptionTarget = { organizationId, subscriptionId: subscription.id, currency: subscription.currency };
  const financeHref = `/organizations/${organizationId}/finance`;
  const current = lines.filter((line) => line.inForce || line.startsOn > today);
  const primary = current.find((line) => line.role === 'primary') ?? null;
  const addons = current.filter((line) => line.role === 'addon');
  const running = status !== 'ended';
  const period = subscription.collection === 'manual' && running ? nextPeriod(model) : null;
  const lineLabel = (line: SubscriptionLineView) => `${line.item?.name ?? 'Item'}${line.role === 'addon' ? ' (add-on)' : ''}`;
  const meterLabel = (meterId: string) => platform?.meters.find((meter) => meter.id === meterId)?.label ?? meterId;

  return (
    <AppPage>
      <RecordHeader
        title={customer.name}
        crumbs={[
          { label: 'Finance', href: financeHref },
          { label: 'Subscriptions', href: `${financeHref}/subscriptions` },
          { label: customer.name },
        ]}
        summary={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status === 'active' ? 'success' : status === 'ended' ? 'neutral' : 'accent'}>{SUBSCRIPTION_STATUS_LABEL[status]}</Badge>
            <span>Billed every {INTERVAL_WORD[subscription.billingInterval]} in {subscription.currency}</span>
            <span>· {subscription.collection === 'provider' ? 'Collected by Stripe' : 'Invoiced from Finance'}</span>
            {platform ? <Badge tone={platform.access.permitted ? 'success' : 'danger'}>{platform.access.permitted ? 'Service available' : 'Service locked'}</Badge> : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {links.customer ? <ButtonLink href={links.customer} tone="secondary" size="small">Customer</ButtonLink> : null}
            {links.administration ? <ButtonLink href={links.administration} tone="secondary" size="small">Business in Administration</ButtonLink> : null}
            {may.manage && running ? <CancelSubscriptionSheet target={target} today={today} /> : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="text-xl">{primary?.item?.name ?? 'Nothing in force'}</CardTitle>
            {may.manage && running ? (
              <div className="flex flex-wrap gap-2">
                {options.items.length ? <ChangeItemSheet target={target} items={options.items} today={today} /> : null}
                {options.addons.length ? <AddAddonSheet target={target} addons={options.addons} today={today} /> : null}
                {current.length ? <SetPriceSheet target={target} lines={current.map((line) => ({ value: line.id, label: lineLabel(line) }))} /> : null}
                {addons.length ? <EndAddonSheet target={target} addons={addons.map((line) => ({ value: line.id, label: line.item?.name ?? 'Add-on' }))} today={today} /> : null}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <DataTable
            rows={current}
            rowKey={(line) => line.id}
            empty="Nothing is in force or scheduled."
            columns={[
              { key: 'item', header: 'Item', emphasis: 'primary', cell: (line) => <span className="flex flex-col"><span className="font-medium">{line.item?.name ?? 'Item'}</span>{line.role === 'addon' ? <span className="text-xs text-muted-foreground">Add-on</span> : null}</span> },
              { key: 'quantity', header: 'Quantity', numeric: true, cell: (line) => line.quantity.toLocaleString() },
              { key: 'price', header: 'Price', numeric: true, cell: (line) => linePrice(line) },
              { key: 'list', header: 'List price', numeric: true, visibility: 'card-only', cell: (line) => (line.listPrice ? formatMoney(line.listPrice.amountMinor, line.listPrice.currency) : '—') },
              { key: 'from', header: 'From', cell: (line) => day(line.startsOn) },
              { key: 'until', header: 'Last day', cell: (line) => lastDay(line.endsOn) },
            ]}
          />
          <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-medium">
            <span>Every {INTERVAL_WORD[subscription.billingInterval]}</span>
            <span className="tabular-nums">{amount ? formatMoney(amount.amountMinor, amount.currency) : current.length ? 'Unknown: a line is not priced' : '—'}</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          {platform ? <TabsTrigger value="entitlements">What it switches on</TabsTrigger> : null}
          {platform ? <TabsTrigger value="allowances">Allowances</TabsTrigger> : null}
          {platform ? <TabsTrigger value="usage">Usage prices</TabsTrigger> : null}
          {platform ? <TabsTrigger value="billing">Stripe</TabsTrigger> : null}
          {platform && economics ? <TabsTrigger value="economics">Economics</TabsTrigger> : null}
          {platform ? <TabsTrigger value="terms">Per-product terms</TabsTrigger> : null}
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4 flex flex-col gap-4">
          {period && may.issue ? (
            <div><IssueInvoiceSheet target={target} period={`${day(period.start)} to ${lastDay(period.end)}`} /></div>
          ) : null}
          <DataTable
            rows={invoices}
            rowKey={({ invoice }) => invoice.id}
            empty={subscription.collection === 'provider' ? 'Stripe has not reported an invoice yet.' : 'No period has been invoiced yet.'}
            columns={[
              { key: 'number', header: 'Invoice', emphasis: 'primary', cell: ({ invoice }) => <span className="flex flex-col"><Link className="font-medium underline-offset-4 hover:underline" href={`${financeHref}/invoices?invoice=${invoice.id}`}>#{invoice.number}</Link>{invoice.providerNumber ? <span className="text-xs text-muted-foreground">{invoice.providerNumber}</span> : null}</span> },
              { key: 'period', header: 'Period', cell: ({ invoice }) => (invoice.periodStart && invoice.periodEnd ? `${day(invoice.periodStart)} to ${lastDay(invoice.periodEnd)}` : '—') },
              { key: 'issued', header: 'Issued', visibility: 'card-only', cell: ({ invoice }) => day(invoice.issuedAt) },
              { key: 'total', header: 'Total', numeric: true, cell: ({ standing }) => (standing.total ? formatMoney(standing.total.totalMinor, standing.total.currency) : '—') },
              { key: 'status', header: 'Status', cell: ({ invoice, standing }) => <InvoiceStandingBadge row={{ settled: standing.settled, overdue: !standing.settled && invoice.dueAt !== null && invoice.dueAt < new Date().toISOString(), voided: invoice.voidedAt !== null }} /> },
            ]}
          />
        </TabsContent>

        {platform ? (
          <TabsContent value="entitlements" className="mt-4 flex flex-col gap-6">
            <p className="text-sm">
              {links.administration ? <Link className="font-medium underline-offset-4 hover:underline" href={links.administration}>{platform.tenant.name}</Link> : <span className="font-medium">{platform.tenant.name}</span>}
              <span className="text-muted-foreground"> · {describeServiceAccess(platform.access)}</span>
            </p>
            {platform.features.map(({ product, modules }) => (
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
            ))}
          </TabsContent>
        ) : null}

        {platform ? (
          <TabsContent value="allowances" className="mt-4">
            {platform.allowances.length === 0 ? (
              <p className="text-sm text-muted-foreground">No allowances.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {platform.allowances.map((allowance) => (
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
                          <dd className="text-right text-xs tabular-nums">{allowance.included.planDefault === null ? '—' : allowance.included.planDefault.toLocaleString()}</dd>
                          <dt className="text-xs text-muted-foreground">For this business</dt>
                          <dd className="text-right text-xs tabular-nums">{allowance.included.override?.toLocaleString()}</dd>
                        </>
                      ) : null}
                      <dt className="text-muted-foreground">In force</dt>
                      <dd className="text-right tabular-nums">{allowance.included.effective.toLocaleString()} {allowance.unit}{allowance.period !== 'none' ? ` / ${allowance.period}` : ''}</dd>
                      <dt className="text-xs text-muted-foreground">Hard limit</dt>
                      <dd className="text-right text-xs tabular-nums">{allowance.hardLimit === null ? 'None' : allowance.hardLimit.toLocaleString()}</dd>
                      <dt className="text-xs text-muted-foreground">Beyond it</dt>
                      <dd className="text-right text-xs">{allowance.overageBehavior ? OVERAGE_BEHAVIOR_LABEL[allowance.overageBehavior] : '—'}</dd>
                    </dl>
                    {allowance.runtime ? <div className="mt-2 border-t border-border pt-1"><AllowanceMeter state={allowance.runtime} className="py-0" /></div> : null}
                  </SurfaceCard>
                ))}
              </div>
            )}
            {may.manage && platform.basePlanId && platform.allowances.length ? (
              <div className="mt-4">
                <OverrideAllowanceSheet target={target} tenantId={platform.tenant.id} planId={platform.basePlanId} today={today}
                  allowances={platform.allowances.map((allowance) => ({ allowanceKey: allowance.allowanceKey, label: allowance.label, includedQuantity: allowance.included.effective }))} />
              </div>
            ) : null}
          </TabsContent>
        ) : null}

        {platform ? (
          <TabsContent value="usage" className="mt-4 flex flex-col gap-4">
            {may.manage && primary && running ? <div><UsagePriceSheet target={target} lineId={primary.id} meters={platform.meters.map((meter) => ({ value: meter.id, label: meter.label }))} /></div> : null}
            <DataTable
              rows={platform.agreedUsagePrices}
              rowKey={(row) => row.id}
              empty="No usage price is agreed: the plan's own usage prices apply."
              columns={[
                { key: 'meter', header: 'Meter', emphasis: 'primary', cell: (row) => meterLabel(row.meterId) },
                { key: 'price', header: 'Agreed price per unit', numeric: true, cell: (row) => formatMicros(row.unitAmountMicros, row.currency) },
                { key: 'from', header: 'From', cell: (row) => day(row.effectiveFrom) },
                { key: 'until', header: 'Until', cell: (row) => (row.effectiveTo ? day(row.effectiveTo) : 'Ongoing') },
              ]}
            />
            {primary?.item ? <Link href={`${financeHref}/catalog/${primary.item.id}`} className="w-fit text-sm font-medium underline-offset-4 hover:underline">{primary.item.name} usage prices</Link> : null}
          </TabsContent>
        ) : null}

        {platform ? (
          <TabsContent value="billing" className="mt-4 flex flex-col gap-6">
            {platform.billing.subscription ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{platform.billing.subscription.status.replace('_', ' ')}</dd></div>
                <div>
                  <dt className="text-muted-foreground">Current period ends</dt>
                  <dd className="font-medium">{platform.billing.subscription.currentPeriodEnd ? day(platform.billing.subscription.currentPeriodEnd) : '—'}{platform.billing.subscription.cancelAtPeriodEnd ? ' (canceling)' : ''}</dd>
                </div>
                <div><dt className="text-muted-foreground">Matches checkout</dt><dd className="font-medium">{RECONCILIATION_STATE_LABEL[platform.billing.subscription.reconciliationState]}</dd></div>
                <div><dt className="text-muted-foreground">Environment</dt><dd className="font-medium">{platform.billing.environment ?? '—'}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Stripe holds no subscription for {platform.tenant.name}{platform.billing.environment ? ` in ${platform.billing.environment}` : ''}.</p>
            )}
            {platform.billing.subscription && platform.billing.subscription.reconciliationIssues.length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {platform.billing.subscription.reconciliationIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{describeReconciliationIssue(issue)}</li>)}
              </ul>
            ) : null}
            {may.manage && platform.basePlanId && primary?.price?.source === 'agreed' ? (
              <div><PrepareAgreedPriceButton target={target} tenantId={platform.tenant.id} planId={platform.basePlanId} /></div>
            ) : null}
            <div>
              <SectionHeading>Stripe items</SectionHeading>
              <div className="mt-3">
                <DataTable
                  rows={platform.billing.items}
                  rowKey={(item) => item.id}
                  empty="Stripe holds no items."
                  columns={[
                    { key: 'item', header: 'Item', emphasis: 'primary', cell: (item) => (item.canonicalSource?.planId ? (platform.plans.find((plan) => plan.id === item.canonicalSource?.planId)?.label ?? 'Plan') : 'Price not matched to a plan') },
                    { key: 'price', header: 'Stripe price', cell: (item) => <span className="font-mono text-xs">{item.providerPriceReference}</span> },
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
                  rows={platform.billing.events}
                  rowKey={(event) => event.id}
                  empty="No delivery for this business yet."
                  columns={[
                    { key: 'type', header: 'Event', emphasis: 'primary', cell: (event) => <span className="font-mono text-xs">{event.eventType}</span> },
                    { key: 'received', header: 'Received', cell: (event) => new Date(event.receivedAt).toLocaleString() },
                    { key: 'applied', header: 'Applied', cell: (event) => (event.application === 'stale' ? 'Older than state held' : event.application === 'ambiguous' ? 'Conflicting, not applied' : event.application === 'unmatched' ? 'No subscription to match' : event.application === 'applied' ? 'Applied' : 'Notice') },
                  ]}
                />
              </div>
            </div>
          </TabsContent>
        ) : null}

        {platform && economics ? (
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
            {economics.storage ? <div className="mt-4 border-t border-border pt-3"><AllowanceMeter state={economics.storage} className="py-0" /></div> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink href={`${financeHref}/economics/${platform.tenant.id}`} tone="text" size="small">Cost to serve</ButtonLink>
              <ButtonLink href={`${financeHref}/economics/packages?source=organization_agreement&id=${platform.tenant.id}`} tone="text" size="small">Simulate this agreement</ButtonLink>
            </div>
          </TabsContent>
        ) : null}

        {platform ? (
          <TabsContent value="terms" className="mt-4 flex flex-col gap-4">
            {may.manage ? <div><RecordTermSheet target={target} tenantId={platform.tenant.id} products={platform.products.map((product) => ({ value: product.key, label: product.label }))} /></div> : null}
            <DataTable
              rows={platform.terms}
              rowKey={(row) => row.id}
              empty="No per-product terms."
              columns={[
                { key: 'product', header: 'Product', emphasis: 'primary', cell: (row) => platform.products.find((product) => product.key === row.productKey)?.label ?? row.productKey },
                { key: 'period', header: 'Period', cell: (row) => `${row.periodStart} to ${row.periodEnd === '9999-12-31' ? 'ongoing' : row.periodEnd}` },
                { key: 'price', header: 'Price', numeric: true, cell: (row) => (row.currency ? formatMoney(row.priceMinor, row.currency) : 'No charge') },
              ]}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="history" className="mt-4 flex flex-col gap-8">
          <div>
            <SectionHeading>Lines</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={lines}
                rowKey={(line) => line.id}
                empty="No line has been recorded."
                columns={[
                  { key: 'item', header: 'Item', emphasis: 'primary', cell: (line) => lineLabel(line) },
                  { key: 'from', header: 'From', cell: (line) => day(line.startsOn) },
                  { key: 'until', header: 'Last day', cell: (line) => lastDay(line.endsOn) },
                ]}
              />
            </div>
          </div>
          <div>
            <SectionHeading>Agreed prices</SectionHeading>
            <div className="mt-3">
              <DataTable
                rows={lines.flatMap((line) => line.agreedPrices.map((price) => ({ price, line })))}
                rowKey={({ price }) => price.id}
                empty="No price has been agreed: every line pays its list price."
                columns={[
                  { key: 'item', header: 'Item', emphasis: 'primary', cell: ({ line }) => lineLabel(line) },
                  { key: 'amount', header: 'Agreed price', numeric: true, cell: ({ price }) => formatMoney(price.amountMinor, price.currency) },
                  { key: 'from', header: 'From', cell: ({ price }) => day(price.effectiveFrom) },
                  { key: 'until', header: 'Until', cell: ({ price }) => (price.effectiveTo ? day(price.effectiveTo) : 'Ongoing') },
                ]}
              />
            </div>
          </div>
          {platform ? (
            <div>
              <SectionHeading>Allowance changes</SectionHeading>
              <div className="mt-3">
                <DataTable
                  rows={platform.quotaOverrides}
                  rowKey={(row) => row.id}
                  empty="No allowance has been changed."
                  columns={[
                    { key: 'allowance', header: 'Allowance', emphasis: 'primary', cell: (row) => row.allowanceKey },
                    { key: 'quantity', header: 'Included', numeric: true, cell: (row) => row.includedQuantity.toLocaleString() },
                    { key: 'from', header: 'From', cell: (row) => day(row.effectiveFrom) },
                  ]}
                />
              </div>
            </div>
          ) : null}
          {subscription.canceledAt ? (
            <p className="text-sm text-muted-foreground">Ending recorded {day(subscription.canceledAt)}{subscription.cancelReason ? `: ${subscription.cancelReason}` : ''}.</p>
          ) : null}
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}
