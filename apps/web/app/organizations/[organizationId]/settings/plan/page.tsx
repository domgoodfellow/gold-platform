import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { communicationsAccount } from '@/lib/domain/communications/credits';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms, moduleCommercialState } from '@/lib/domain/commercial/terms';
import { listUsageEvents } from '@/lib/domain/commercial/usage';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

function formatMinor(amountMinor: number, currency: string | null): string {
  if (!currency) return String(amountMinor);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}

function stateSentence(state: { wanted: boolean; paid: boolean; periodEnd: string | null }): string {
  if (state.wanted && state.paid) return 'On.';
  if (state.wanted && !state.paid) {
    return 'Switched on, but nothing is currently paying for it. Nothing recorded has been removed — GOLD can record a term to restore it.';
  }
  if (!state.wanted && state.paid) {
    return `Paid for through ${state.periodEnd ?? 'an open period'}, but switched off in this business's own settings.`;
  }
  return 'Not part of this business.';
}

/**
 * What this business is entitled to use, what GOLD has recorded selling it, what it used, and
 * what that cost it — never what it cost GOLD, and never a margin (`constraints.md` D43). A
 * detail route under Settings, like `settings/work`, so it writes its own heading rather than
 * one `navigation.ts` also owns.
 */
export default async function PlanAndUsagePage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/plan'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [states, terms, products, usage, account] = await Promise.all([
    moduleCommercialState(db, { organizationId }),
    listOrganizationTerms(db, { organizationId }),
    listProducts(db),
    listUsageEvents(db, { organizationId, limit: 50 }),
    communicationsAccount(db, { organizationId, currency: organization.currency }),
  ]);

  const productLabel = new Map(products.map((product) => [product.key, product.label]));

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>Plan &amp; usage</PageHeading>
      <Hint className="mt-1">
        What this business is entitled to use right now, what GOLD has recorded selling it, and
        what it has used. Nothing here is what any of it cost GOLD to provide.
      </Hint>

      <Section className="mt-8">
        <SectionHeading>What this business uses</SectionHeading>
        {states.length === 0 ? (
          <EmptyState className="mt-2">Nothing switched on beyond what every business gets.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {states.map((state) => (
              <div key={state.moduleKey} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-medium">{productLabel.get(`module:${state.moduleKey}`) ?? state.moduleKey}</span>
                <span className="text-sm text-muted">{stateSentence(state)}</span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>What&rsquo;s been bought</SectionHeading>
        {terms.length === 0 ? (
          <EmptyState className="mt-2">Nothing recorded yet.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {terms.map((term) => (
              <div key={term.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="font-medium">{productLabel.get(term.productKey) ?? term.productKey}</span>
                <span className="text-muted">
                  {term.periodStart} – {term.periodEnd === '9999-12-31' ? 'ongoing' : term.periodEnd}
                </span>
                <span className="tabular-nums">
                  {term.priceMinor === 0 ? 'No charge' : formatMinor(term.priceMinor, term.currency)}
                </span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Usage</SectionHeading>
        <Hint className="mt-1">
          What GOLD charged for what this business used. Recent activity, most recent first.
        </Hint>
        {usage.length === 0 ? (
          <EmptyState className="mt-2">Nothing metered yet.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {usage.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="tabular-nums text-subtle">
                  {new Date(entry.occurredAt).toLocaleString('en-CA')}
                </span>
                <span className="font-medium">{entry.meterId}</span>
                <span>{entry.quantity}</span>
                <span className="tabular-nums">{formatMinor(entry.customerChargeMinor, entry.customerCurrency)}</span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Calling credit</SectionHeading>
        {account.priced ? (
          <Hint className="mt-1">
            {formatMinor(account.balanceMinor, organization.currency)} left.
          </Hint>
        ) : (
          <EmptyState className="mt-2">
            This deployment has not priced any channel for this business, so nothing is drawn down.
          </EmptyState>
        )}
      </Section>
    </SettingsPageFrame>
  );
}
