import { redirect } from 'next/navigation';
import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff, getTenant } from '@/lib/domain/platform/tenants';
import { listMeters, listProducts, listProviderRates, listRetailRates } from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms, moduleCommercialState } from '@/lib/domain/commercial/terms';
import { listProviderSyncFailures, organizationCommercialSummary } from '@/lib/domain/commercial/usage';
import { communicationsAccount } from '@/lib/domain/communications/credits';
import { RecordCommercialTermForm, RecordRateForm } from './forms';

export const dynamic = 'force-dynamic';

function formatMinor(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}

/**
 * One business, from GOLD's own side: what it wants and has paid for, what it used, what that
 * cost GOLD, what it was charged, and the margin between the two — never shown to the tenant
 * itself (`constraints.md` D43). `(platform)` is a route group, not a security boundary, exactly
 * as `/platform` itself says — every read below runs under RLS as `platform_staff`, and a
 * non-staff caller sees empty tables regardless of this redirect.
 */
export default async function PlatformOrganizationPage({
  params,
}: PageProps<'/platform/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') redirect('/login');
    throw error;
  }

  if (!(await isPlatformStaff(db))) redirect('/organizations');

  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect('/platform');

  const [states, terms, meters, products, providerRates, retailRates, summary, failures, account] =
    await Promise.all([
      moduleCommercialState(db, { organizationId }),
      listOrganizationTerms(db, { organizationId }),
      listMeters(db),
      listProducts(db),
      listProviderRates(db),
      listRetailRates(db),
      organizationCommercialSummary(db, { organizationId }),
      listProviderSyncFailures(db, { organizationId }),
      communicationsAccount(db, { organizationId, currency: tenant.currency || null }),
    ]);

  const productLabel = new Map(products.map((product) => [product.key, product.label]));
  const meterOptions = meters.map((meter) => ({ value: meter.id, label: `${meter.id} (${meter.provider}, per ${meter.unit})` }));
  const productOptions = products.map((product) => ({ value: product.key, label: product.label }));

  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <div className="flex items-baseline justify-between">
        <PageHeading>{tenant.name}</PageHeading>
        <ButtonLink href="/platform" tone="text" size="small">
          ‹ Platform
        </ButtonLink>
      </div>
      <Hint className="mt-2">
        {tenant.currency ? `Trades in ${tenant.currency}.` : 'Has not said what it trades in yet.'}
      </Hint>

      <Section className="mt-8">
        <SectionHeading>Entitlement</SectionHeading>
        {states.length === 0 ? (
          <EmptyState className="mt-2">Nothing switched on beyond the operational core.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {states.map((state) => (
              <div key={state.moduleKey} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="font-medium">{productLabel.get(`module:${state.moduleKey}`) ?? state.moduleKey}</span>
                <span className={state.wanted && !state.paid ? 'text-danger' : 'text-subtle'}>
                  {state.wanted ? 'wanted' : 'not wanted'} · {state.paid ? `paid through ${state.periodEnd}` : 'not paid'}
                </span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Recurring terms</SectionHeading>
        {terms.length === 0 ? (
          <EmptyState className="mt-2">Nothing recorded yet.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {terms.map((term) => (
              <div key={term.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="font-medium">{productLabel.get(term.productKey) ?? term.productKey}</span>
                <span className="text-subtle">
                  {term.periodStart} – {term.periodEnd === '9999-12-31' ? 'ongoing' : term.periodEnd}
                </span>
                <span className="tabular-nums">
                  {term.priceMinor === 0 || !term.currency ? 'No charge' : formatMinor(term.priceMinor, term.currency)}
                </span>
              </div>
            ))}
          </DividedList>
        )}
        <RecordCommercialTermForm organizationId={organizationId} products={productOptions} />
      </Section>

      <Section className="mt-8">
        <SectionHeading>Usage, cost, charge and margin</SectionHeading>
        {summary.length === 0 ? (
          <EmptyState className="mt-2">Nothing metered yet.</EmptyState>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-subtle">
                  <th className="pr-4">Meter</th>
                  <th className="pr-4">Quantity</th>
                  <th className="pr-4">GOLD&rsquo;s cost</th>
                  <th className="pr-4">Charged</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={`${row.meterId}-${row.currency}`}>
                    <td className="pr-4">{row.meterId}</td>
                    <td className="pr-4 tabular-nums">{row.quantity}</td>
                    <td className="pr-4 tabular-nums">{formatMinor(row.providerCostMinor, row.currency)}</td>
                    <td className="pr-4 tabular-nums">{formatMinor(row.customerChargeMinor, row.currency)}</td>
                    <td className="tabular-nums">{formatMinor(row.marginMinor, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Calling credit</SectionHeading>
        {account.priced ? (
          <Hint className="mt-1">{formatMinor(account.balanceMinor, tenant.currency ?? '')} left.</Hint>
        ) : (
          <EmptyState className="mt-2">No channel is priced for this business.</EmptyState>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Rate snapshots</SectionHeading>
        <Hint className="mt-1">What GOLD pays a provider, and what GOLD charges — not this business&rsquo;s own.</Hint>

        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Provider (wholesale)</p>
            {providerRates.length === 0 ? (
              <p className="mt-1 text-sm text-subtle">Nothing recorded yet.</p>
            ) : (
              <DividedList as="div" className="mt-1">
                {providerRates.map((rate) => (
                  <div key={rate.id} className="py-1 text-sm">
                    {rate.meterId} — {rate.unitAmountMicros} micro-{rate.currency}/unit ({rate.approvalState})
                  </div>
                ))}
              </DividedList>
            )}
            <RecordRateForm organizationId={organizationId} kind="provider" meters={meterOptions} />
          </div>

          <div>
            <p className="text-sm font-medium">Retail</p>
            {retailRates.length === 0 ? (
              <p className="mt-1 text-sm text-subtle">Nothing recorded yet — voice, SMS and email stay priced through Settings → Communications (D40).</p>
            ) : (
              <DividedList as="div" className="mt-1">
                {retailRates.map((rate) => (
                  <div key={rate.id} className="py-1 text-sm">
                    {rate.meterId} — {rate.unitAmountMicros} micro-{rate.currency}/unit ({rate.approvalState})
                  </div>
                ))}
              </DividedList>
            )}
            <RecordRateForm organizationId={organizationId} kind="retail" meters={meterOptions} />
          </div>
        </div>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Provider sync failures</SectionHeading>
        {failures.length === 0 ? (
          <EmptyState className="mt-2">
            Nothing has failed. Reconciling an estimate against a provider&rsquo;s real bill is not
            wired up yet, so this is empty rather than checked.
          </EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {failures.map((failure) => (
              <div key={failure.id} className="py-2 text-sm">
                <span className="tabular-nums text-subtle">{new Date(failure.occurredAt).toLocaleString('en-CA')}</span>{' '}
                <span>{failure.meterId ?? 'unknown meter'}</span> — <span>{failure.detail}</span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>
    </main>
  );
}
