import { PageHeader } from '@/components/headers/page-header';
import { Card } from '@/components/surfaces/card';
import { EmptyState, SectionHeading } from '@/components/surfaces/section';
import { AppPage } from '@/components/layout/app-page';
import { Hint } from '@/components/controls/inputs';
import { LaunchReview, SetupAreaList, SetupProgressCard } from '@/features/setup/setup-cockpit';
import {
  canDraftConfiguration,
  currentConfigurationProposal,
  listConfigurationProposals,
} from '@/lib/domain/configuration/proposals';
import { describeDiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import { getFoundingHandoff } from '@/lib/domain/customers/proposal-handoff';
import { computeSetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { requireOrganization } from '@/lib/route/organization';
import { DescribeForm } from '@/features/setup/describe-form';
import { FoundingHandoff } from '@/features/setup/founding-handoff';
import { LaunchForm } from '@/features/setup/launch-form';
import { ProposalHistory } from '@/features/setup/proposal-history';
import { ProposalReview } from '@/features/setup/proposal-review';

export const dynamic = 'force-dynamic';

/**
 * The setup cockpit: what is finished, what blocks launch, where each thing is configured, and
 * the one deliberate Launch.
 *
 * **This screen is a map, not a second configuration model.** Every area links to the workspace
 * that owns it and no field of any of them is copied here. The areas come from
 * `computeSetupOverview`, which builds on `computeReadiness` — and which modules count as
 * blockers is the database's answer (I27), never this page's.
 *
 * **Drafting is one optional route through it.** A proposal is a row between the drafting and the
 * applying (`constraints.md` D32): nothing on it has happened to the business until somebody
 * presses Apply, and it goes through `configureBusiness` like any typed setup. A deployment or a
 * business without drafting still has every area above, in full.
 *
 * **A Sales-founded business does not describe itself twice.** The first draft's description box
 * is filled from `discoverySnapshot` — what Sales already recorded, verbatim, never invented — so
 * pressing "Draft a setup" drafts from what is already known rather than a blank box. Still a
 * human's own act: the box is editable, drafting still needs `configuration.propose`, and nothing
 * is applied until Apply is pressed, same as ever.
 */
export default async function SetupPage({
  params,
}: PageProps<'/organizations/[organizationId]/setup'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const inSetup = organization.operationalState === 'setup';

  const [overview, proposal, history, canDraft, usableModules, foundingHandoff] = await Promise.all([
    computeSetupOverview(db, { organizationId }),
    currentConfigurationProposal(db, { organizationId }),
    listConfigurationProposals(db, { organizationId }),
    canDraftConfiguration(),
    listUsableModules(db, { organizationId }),
    getFoundingHandoff(db, { organizationId }),
  ]);

  // Asking for a proposal is its own authority; applying one is not, because every step of
  // applying is already gated by the capability that step needs (D32). So Apply and Launch are
  // shown to everybody who could plausibly press them and refused by the database — I12's rule,
  // not a shortcut around it.
  const mayPropose = organization.capabilities.includes('configuration.propose');
  const mayLaunch = organization.capabilities.includes('organization.manage');
  const draftingOn = usableModules.has('drafting');
  const pastProposals = history.filter((entry) => entry.outcome !== 'draft');

  // Prefill the very first draft from what Sales already recorded, and never again — a
  // refinement already carries the prior shape forward on its own (proposeAction's `previous`),
  // and a business that has already drafted once has moved past re-describing itself from
  // scratch either way.
  const defaultDescription =
    foundingHandoff && !proposal && history.length === 0
      ? describeDiscoverySnapshot({ answers: foundingHandoff.discoverySnapshot }) || undefined
      : undefined;

  return (
    <AppPage>
      <PageHeader
        title="Organization readiness"
        meta={
          inSetup
            ? `Complete the required setup for ${organization.name}.`
            : 'This business is live. These are the areas setup covers, for when one needs changing.'
        }
      />

      <div className="space-y-4">
        {foundingHandoff ? <FoundingHandoff handoff={foundingHandoff} /> : null}

        {inSetup ? <SetupProgressCard overview={overview} /> : null}

        <SetupAreaList areas={overview.areas} />

        {inSetup ? (
          <LaunchReview
            overview={overview}
            launch={
              mayLaunch ? (
                <LaunchForm organizationId={organizationId} />
              ) : (
                <Hint>Your role, {organization.role}, cannot launch this business.</Hint>
              )
            }
          />
        ) : null}

        {draftingOn ? (
          <Card id="agent-setup" as="section" aria-labelledby="setup-agent-heading">
            <SectionHeading id="setup-agent-heading">Set up faster with Agent</SectionHeading>
            <Hint className="mt-1 max-w-2xl">
              Describe how the business works. GildOps can draft configuration for you to read and
              change first — nothing takes effect until you apply it.
            </Hint>

            {/* Application state in the platform's own voice. A deployment with no drafting behind
                it says so rather than rendering a box that takes three paragraphs and refuses
                them (D31) — and the areas above stay fully usable. */}
            {!canDraft ? (
              <p className="mt-4 max-w-2xl rounded border border-border p-3 text-sm">
                This installation cannot draft a setup. Every area above can still be configured
                directly.
              </p>
            ) : null}

            {canDraft && !mayPropose ? (
              <p className="mt-4 max-w-2xl rounded border border-border p-3 text-sm">
                Your role, {organization.role}, cannot ask for a setup to be drafted here.
              </p>
            ) : null}

            {canDraft ? (
              <DescribeForm
                organizationId={organizationId}
                refining={proposal !== null}
                disabled={!mayPropose}
                defaultDescription={defaultDescription}
              />
            ) : null}

            {proposal ? (
              <ProposalReview organizationId={organizationId} proposal={proposal} />
            ) : (
              canDraft && (
                <EmptyState className="mt-6 max-w-2xl">Nothing is waiting to be reviewed.</EmptyState>
              )
            )}
          </Card>
        ) : null}

        <ProposalHistory proposals={pastProposals} />
      </div>
    </AppPage>
  );
}
