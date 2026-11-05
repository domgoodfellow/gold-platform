import { BusinessProfileSettings } from '@/features/tenancy/business-profile-settings';
import { PageHeader } from '@/components/headers/page-header';
import { Card } from '@/components/surfaces/card';
import { EmptyState, SectionHeading } from '@/components/surfaces/section';
import { AppPage } from '@/components/layout/app-page';
import { Hint } from '@/components/controls/inputs';
import { GuidedSetup } from '@/features/setup/guided-setup';
import { setupGuide, resumeSetupStep, setupStepHref } from '@/features/setup/setup-guide';
import { OrganizationSettingsForm } from '@/features/tenancy/organization-settings-form';
import { ButtonLink } from '@/components/controls/button';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import {
  canDraftConfiguration,
  currentConfigurationProposal,
  listConfigurationProposals,
} from '@/lib/domain/configuration/proposals';
import { describeDiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import { getFoundingHandoff } from '@/lib/domain/customers/proposal-handoff';
import { computeSetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { getOrganizationIdentity } from '@/lib/domain/tenancy/identity';
import { requireOrganization } from '@/lib/route/organization';
import { DescribeForm } from '@/features/setup/describe-form';
import { FoundingHandoff } from '@/features/setup/founding-handoff';
import { LaunchForm } from '@/features/setup/launch-form';
import { ProposalHistory } from '@/features/setup/proposal-history';

export const dynamic = 'force-dynamic';

/**
 * The setup cockpit: what is finished, what blocks launch, where each thing is configured, and
 * the one deliberate Launch.
 *
 * **This screen is a map, not a second configuration model.** Every area links to the workspace
 * that owns it and no field of any of them is copied here. The areas come from
 * `computeSetupOverview`, which builds on `computeReadiness` — and which modules count as
 * blockers is the database's answer, never this page's.
 *
 * **Drafting is one optional route through it.** A proposal is a row between the drafting and the
 * applying (the draft-then-apply rule, ADR-039): nothing on it has happened to the business until somebody
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
  searchParams,
}: PageProps<'/organizations/[organizationId]/setup'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const identity = await getOrganizationIdentity(db, organizationId);
  const inSetup = organization.operationalState === 'setup';

  const states = await organizationResolvedFeatureStates(db, { organizationId });
  const [overview, proposal, history, canDraft, foundingHandoff, schedulableWork] = await Promise.all([
    computeSetupOverview(db, { organizationId }, states),
    currentConfigurationProposal(db, { organizationId }),
    listConfigurationProposals(db, { organizationId }),
    canDraftConfiguration(),
    getFoundingHandoff(db, { organizationId }),
    hasSchedulableWork(db, { organizationId }),
  ]);

  // Asking for a proposal is its own authority; applying one is not, because every step of
  // applying is already gated by the capability that step needs. Offered owner links and
  // Launch still respect this actor's authority; each write independently rechecks that authority.
  const mayPropose = organization.capabilities.includes('configuration.propose');
  const mayLaunch = organization.capabilities.includes('organization.manage');
  const draftingOn = mayPropose || proposal !== null;
  const steps = setupGuide(organizationId, overview, {
    enabledModules: activeModuleKeys(states), featureAvailability: availableFeatureKeys(states),
    capabilities: new Set(organization.capabilities), schedulableWork,
  });
  const requested = (await searchParams).step;
  const resume = resumeSetupStep(steps);
  const selected = steps.find((step) => step.key === requested) ?? resume;
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
        title={inSetup ? 'Set up your organization' : 'Organization setup'}
        actions={<ButtonLink href={setupStepHref(organizationId, resume.key)} tone="secondary" size="small">Resume setup</ButtonLink>}
        meta={
          inSetup
            ? `Complete the required setup for ${organization.name}.`
            : 'This business is live. These are the areas setup covers, for when one needs changing.'
        }
      />

      <div className="space-y-4">
        <GuidedSetup organizationId={organizationId} steps={steps} selected={selected} overview={overview} live={!inSetup}
          business={mayLaunch ? <><OrganizationSettingsForm organizationId={organizationId} name={organization.name} timezone={organization.timezone} currency={organization.currency} identity={identity} /><BusinessProfileSettings organizationId={organizationId} embedded/></> : <Hint>Your role cannot change business information.</Hint>}
          handoff={foundingHandoff ? <FoundingHandoff handoff={foundingHandoff} /> : null}
          launch={mayLaunch ? <LaunchForm organizationId={organizationId} /> : <Hint>Your role, {organization.role}, cannot launch this business.</Hint>} />

        {draftingOn ? (
          <Card id="agent-setup" as="section" aria-labelledby="setup-agent-heading">
            <SectionHeading id="setup-agent-heading">Set up faster with Agent</SectionHeading>

            {/* Application state in the platform's own voice. A deployment with no drafting behind
                it says so rather than rendering a box that takes three paragraphs and refuses
                them — and the areas above stay fully usable. */}
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
              <ButtonLink href={`/organizations/${organizationId}/setup/proposal`} tone="secondary" className="mt-4">Review proposed configuration</ButtonLink>
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
