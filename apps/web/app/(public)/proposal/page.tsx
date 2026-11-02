import { notFound, redirect } from 'next/navigation';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { BrandStyle } from '@/features/branding/brand-style';
import { PublicHeader } from '@/features/public-profile/public-header';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getProposalDb } from '@/lib/db/proposal-server';
import {
  commercialProposalTotalMinor,
  listCommercialProposalsForExternalCustomer,
} from '@/lib/domain/customers/commercial-proposals';
import {
  discoverySnapshotCompleteness,
  getDiscoverySnapshot,
} from '@/lib/domain/customers/discovery-snapshots';
import { DISCOVERY_REQUIREMENTS } from '@/lib/domain/customers/discovery-requirements';
import { recommendConfiguration, previewByWorkspace } from '@/lib/domain/customers/configuration-recommendation';
import { proposalAccessContext } from '@/lib/domain/customers/proposal-access';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { RespondForm } from './respond-form';

export const dynamic = 'force-dynamic';

/**
 * A prospect's own commercial proposal (Slice 9). Pays for nothing new on the external axis —
 * see `20261022000003_a_prospect_reviews_their_own_proposal.sql` — the same shared-document
 * link model the portal uses, over the same `external_actors` binding, exchanged once for a
 * session of its own (`[token]/route.ts`, `20261022000046`).
 *
 * Order follows what a prospect needs to judge the number that follows it: what GildOps
 * understood, what it would configure, then the price and the terms — never the reverse.
 */
export default async function ProposalPage() {
  const db = await getProposalDb();

  // The session is the one the link was exchanged for (`[token]/route.ts`). No session, a withdrawn
  // link and an expired exchange are the same answer, so the same page — telling them apart would
  // let somebody holding a dead link learn it had once been real (the no-existence-leak rule's reasoning).
  const access = await proposalAccessContext(db);
  if (!access) redirect('/proposal/unavailable');
  const { organizationId } = access;

  const { data: organization } = await db.from('organizations').select('name, timezone').eq('id', organizationId).maybeSingle();
  if (!organization) notFound();

  const [profile, brand, proposals] = await Promise.all([
    publicProfile(db, { organizationId, fallbackName: organization.name }),
    getBrand(db, { organizationId }),
    listCommercialProposalsForExternalCustomer(db),
  ]);

  const proposal = proposals[0] ?? null;
  if (!proposal) notFound();

  // Discovery and configuration describe a GildOps tenant being set up: they belong to a Platform
  // Plan proposal. A catalog proposal is one business's own offer, so it shows only its terms.
  const platformPlan = proposal.basis === 'platform_plan';
  const snapshot = platformPlan ? await getDiscoverySnapshot(db, { organizationId, customerId: proposal.customerId }) : null;
  const completeness = discoverySnapshotCompleteness({ answers: snapshot?.answers ?? {} });
  const preview = platformPlan ? previewByWorkspace((await recommendConfiguration(db, { answers: snapshot?.answers ?? {} })).recommended) : [];

  return (
    <main data-brand className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <BrandStyle brand={brand} />
      <PublicHeader profile={profile} logoUrl={brand.logoPath ? logoUrl(db, brand.logoPath) : null} />

      {platformPlan ? <Section className="mt-8">
        <SectionHeading>What we understood</SectionHeading>
        <p className="mt-1 text-sm text-subtle">{completeness.answered} of {completeness.total} covered.</p>
        <DefinitionList className="mt-3">
          {DISCOVERY_REQUIREMENTS.filter((requirement) => snapshot?.answers[requirement.key]?.value).map((requirement) => (
            <Detail key={requirement.key} label={requirement.question}>
              {snapshot!.answers[requirement.key]!.value}
            </Detail>
          ))}
        </DefinitionList>
      </Section> : null}

      {preview.length > 0 ? (
        <Section className="mt-8">
          <SectionHeading>How this would be configured</SectionHeading>
          <div className="mt-3 rounded-lg border border-border">
            <div className="divide-y divide-border">
              {preview.map((workspace) => (
                <div key={workspace.workspace} className="px-4 py-3">
                  <div className="text-sm font-medium">{workspace.label}</div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {workspace.entries.map((entry) => (
                      <li key={entry.featureKey} className="pl-3 text-sm text-subtle">
                        {entry.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Section>
      ) : null}

      <Section className="mt-8">
        <SectionHeading>Proposal</SectionHeading>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm font-medium">Version {proposal.version}</span>
          <Badge tone={proposal.status === 'accepted' ? 'success' : 'neutral'}>{proposal.status}</Badge>
        </div>
        {proposal.basis === 'catalog' ? (
          <DefinitionList className="mt-3">
            {proposal.lines.map((line) => (
              <Detail key={line.position} label={line.name}>
                {line.quantity} {line.unit} × {formatMoney(line.unitAmountMinor, line.currency)} = {formatMoney(line.amountMinor, line.currency)}
              </Detail>
            ))}
            <Detail label="Total">
              <strong>{formatMoney(commercialProposalTotalMinor(proposal), proposal.currency)}</strong>, one-off
            </Detail>
          </DefinitionList>
        ) : <DefinitionList className="mt-3">
          <Detail label={proposal.planLabel ?? 'Plan'}>{formatMoney(proposal.planPriceMinor, proposal.currency)}/{proposal.billingInterval}</Detail>
          {proposal.addons.map((addon) => (
            <Detail key={addon.addonPlanId} label={addon.label}>
              {formatMoney(addon.priceMinor, proposal.currency)}/{proposal.billingInterval}
            </Detail>
          ))}
          {proposal.discountMinor > 0 ? (
            <Detail label={`Discount (${proposal.discountReason})`}>-{formatMoney(proposal.discountMinor, proposal.currency)}</Detail>
          ) : null}
          <Detail label="Total">
            <strong>{formatMoney(commercialProposalTotalMinor(proposal), proposal.currency)}/{proposal.billingInterval}</strong>
          </Detail>
        </DefinitionList>}
        {proposal.notes ? <p className="mt-3 text-sm text-subtle">{proposal.notes}</p> : null}

        {proposal.status === 'sent' ? (
          <RespondForm proposalId={proposal.id} />
        ) : proposal.status === 'accepted' ? (
          <p className="mt-4 text-sm text-success">Accepted {new Date(proposal.acceptedAt!).toLocaleDateString()}. Nothing has been charged.</p>
        ) : proposal.status === 'declined' ? (
          <p className="mt-4 text-sm text-subtle">
            Declined {new Date(proposal.declinedAt!).toLocaleDateString()}. Get in touch if anything should change.
          </p>
        ) : null}
      </Section>
    </main>
  );
}
