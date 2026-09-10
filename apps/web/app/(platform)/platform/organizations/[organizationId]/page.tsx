import { redirect } from 'next/navigation';
import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff, getTenant } from '@/lib/domain/platform/tenants';
import {
  listMeters,
  listProducts,
  listProviderRates,
  listProviders,
  listRetailRates,
} from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms, moduleCommercialState } from '@/lib/domain/commercial/terms';
import {
  listProviderSyncFailures,
  organizationCommercialSummary,
  organizationUsageDetail,
} from '@/lib/domain/commercial/usage';
import { communicationsAccount } from '@/lib/domain/communications/credits';
import { listProviderBindings, listProviderResources } from '@/lib/domain/providers/bindings';
import {
  ProvisionTwilioForm,
  RecordCommercialTermForm,
  RecordProviderRateForm,
  RecordRetailRateForm,
  RegisterPhoneNumberForm,
  SetResourceStatusForm,
} from './forms';

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
 *
 * **Two currencies, not one.** A provider's cost and a customer's charge are shown side by side
 * rather than netted whenever they disagree on currency — the margin column says so rather than
 * guessing (D43's correction).
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

  const [
    states,
    terms,
    meters,
    providers,
    products,
    providerRates,
    retailRates,
    summary,
    detail,
    failures,
    account,
    bindings,
    resources,
  ] = await Promise.all([
    moduleCommercialState(db, { organizationId }),
    listOrganizationTerms(db, { organizationId }),
    listMeters(db),
    listProviders(db),
    listProducts(db),
    listProviderRates(db),
    listRetailRates(db),
    organizationCommercialSummary(db, { organizationId }),
    organizationUsageDetail(db, { organizationId }),
    listProviderSyncFailures(db, { organizationId }),
    communicationsAccount(db, { organizationId, currency: tenant.currency || null }),
    listProviderBindings(db, { organizationId }),
    listProviderResources(db, { organizationId }),
  ]);

  const productLabel = new Map(products.map((product) => [product.key, product.label]));
  const providerLabel = new Map(providers.map((provider) => [provider.key, provider.label]));
  const meterOptions = meters.map((meter) => ({ value: meter.id, label: `${meter.id} (per ${meter.unit})` }));
  const providerOptions = providers.map((provider) => ({ value: provider.key, label: provider.label }));
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
        <SectionHeading>Providers</SectionHeading>
        <Hint className="mt-1">
          Which external scope belongs to this business, what GOLD created there, and its own
          last error when something failed — never a secret, which lives in Vault and reaches
          nobody through this screen.
        </Hint>
        {bindings.length === 0 ? (
          <EmptyState className="mt-2">No provider binding yet.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {bindings.map((binding) => (
              <div key={binding.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{providerLabel.get(binding.providerKey) ?? binding.providerKey}</span>
                  <span
                    className={binding.status === 'failed' ? 'text-danger' : 'text-subtle'}
                  >
                    {binding.status}
                  </span>
                  {binding.externalAccountId ? (
                    <span className="text-subtle">{binding.externalAccountId}</span>
                  ) : null}
                  {binding.lastVerifiedAt ? (
                    <span className="text-subtle">
                      verified {new Date(binding.lastVerifiedAt).toLocaleString('en-CA')}
                    </span>
                  ) : null}
                </div>
                {binding.lastError ? (
                  <p className="mt-1 text-danger">{binding.lastError}</p>
                ) : null}
                <div className="mt-1 flex flex-col gap-1 pl-3">
                  {resources
                    .filter((resource) => resource.bindingId === binding.id)
                    .map((resource) => (
                      <div key={resource.id} className="flex flex-wrap items-baseline gap-x-3 text-subtle">
                        <span>{resource.resourceType}</span>
                        <span>{resource.externalId}</span>
                        <span>{resource.status}</span>
                        <span className="font-mono text-xs">{resource.id}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </DividedList>
        )}

        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Twilio</p>
            <ProvisionTwilioForm organizationId={organizationId} />
            <RegisterPhoneNumberForm organizationId={organizationId} />
          </div>
          <div>
            <p className="text-sm font-medium">Any resource</p>
            <SetResourceStatusForm organizationId={organizationId} />
          </div>
        </div>
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
        <Hint className="mt-1">
          Cost and charge are shown in whichever currency each was actually recorded in — a
          margin only appears where the two agree, or where nothing has been priced yet.
        </Hint>
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
                  <tr key={`${row.meterId}-${row.customerCurrency}-${row.providerCurrency ?? 'unpriced'}`}>
                    <td className="pr-4">{row.meterId}</td>
                    <td className="pr-4 tabular-nums">{row.quantity}</td>
                    <td className="pr-4 tabular-nums">
                      {row.providerCurrency
                        ? formatMinor(row.providerCostMinor, row.providerCurrency)
                        : 'unpriced'}
                    </td>
                    <td className="pr-4 tabular-nums">{formatMinor(row.customerChargeMinor, row.customerCurrency)}</td>
                    <td className="tabular-nums">
                      {row.marginMinor === null ? (
                        <span
                          className="text-subtle"
                          title="Cost and charge are in different currencies — not converted."
                        >
                          n/a
                        </span>
                      ) : (
                        formatMinor(row.marginMinor, row.customerCurrency)
                      )}
                    </td>
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
                    {providerLabel.get(rate.providerKey ?? '') ?? rate.providerKey} — {rate.meterId} —{' '}
                    {rate.unitAmountMicros} micro-{rate.currency}/unit ({rate.approvalState})
                  </div>
                ))}
              </DividedList>
            )}
            <RecordProviderRateForm
              organizationId={organizationId}
              meters={meterOptions}
              providers={providerOptions}
            />
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
            <RecordRetailRateForm organizationId={organizationId} meters={meterOptions} />
          </div>
        </div>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Usage detail — estimate vs. reconciled</SectionHeading>
        <Hint className="mt-1">
          What GOLD first estimated a reading cost, and what a provider&rsquo;s own bill later
          confirmed, side by side. The estimate is never overwritten.
        </Hint>
        {detail.length === 0 ? (
          <EmptyState className="mt-2">Nothing metered yet.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {detail.map((row) => (
              <div key={row.usageEventId} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="tabular-nums text-subtle">{new Date(row.occurredAt).toLocaleString('en-CA')}</span>
                <span className="font-medium">{row.meterId}</span>
                <span className="text-subtle">{providerLabel.get(row.providerKey) ?? row.providerKey}</span>
                <span>
                  estimate:{' '}
                  {row.estimatedCurrency
                    ? formatMinor(Math.round(row.estimatedCostMicros / 1_000_000), row.estimatedCurrency)
                    : 'unpriced'}
                </span>
                <span>
                  reconciled:{' '}
                  {row.reconciledCostMicros === null || !row.reconciledCurrency
                    ? '—'
                    : formatMinor(Math.round(row.reconciledCostMicros / 1_000_000), row.reconciledCurrency)}
                </span>
              </div>
            ))}
          </DividedList>
        )}
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
