import { EmptyState } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import {
  canDraftConfiguration,
  currentConfigurationProposal,
  listConfigurationProposals,
} from '@/lib/domain/onboarding/proposals';
import { requireOrganization } from '@/lib/route/organization';
import { DescribeForm, ProposalHistory, ProposalReview } from './setup-forms';

export const dynamic = 'force-dynamic';

/**
 * Describe the business, read back a proposed setup, change it, apply it.
 *
 * **Nothing on this screen has happened to the business yet.** A proposal is a row between the
 * drafting and the applying (`constraints.md` D32), and every word of it is editable until
 * somebody presses Apply — at which point it goes through `configureBusiness`, the same function
 * a test uses and the same one the operator door would, with every write landing on the policy it
 * would have landed on if it had been typed in by hand.
 *
 * **This screen replaces nothing.** Every part of a setup — the kinds of work, the stages, the
 * form, the prices, the hours, the roles — has a screen of its own that predates this module, and
 * a business that switches this off configures itself there. That is why drafting is a module and
 * not kernel.
 */
export default async function SetupPage({
  params,
}: PageProps<'/organizations/[organizationId]/setup'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [proposal, history, canDraft] = await Promise.all([
    currentConfigurationProposal(db, { organizationId }),
    listConfigurationProposals(db, { organizationId }),
    canDraftConfiguration(),
  ]);

  // Asking for a proposal is its own authority; applying one is not, because every step of
  // applying is already gated by the capability that step needs (D32). So the Apply button is
  // shown to everybody and refused by the database — which is I12's rule, not a shortcut around
  // it: hiding it would make this screen the place that decides, and the policies would still be
  // the place that does.
  const mayPropose = organization.capabilities.includes('configuration.propose');

  return (
    <>
      <Hint className="mt-6 max-w-2xl">
        Say what this business does, in your own words, and get a setup back to read and change
        before any of it takes effect. Everything it proposes can also be filled in by hand on the
        other screens.
      </Hint>

      {/* Application state in the platform's own voice, which is the one thing it may describe.
          A deployment with no drafting behind it says so rather than rendering a box that takes
          three paragraphs and then refuses them (D31). */}
      {!canDraft && (
        <p className="mt-4 max-w-2xl rounded border border-border p-3 text-sm">
          This installation cannot draft a setup, so nothing can be proposed here. Every part of
          it can still be filled in on the other screens.
        </p>
      )}

      {canDraft && !mayPropose && (
        <p className="mt-4 max-w-2xl rounded border border-border p-3 text-sm">
          Your role, {organization.role}, cannot ask for a setup to be drafted here.
        </p>
      )}

      {canDraft && (
        <DescribeForm
          organizationId={organizationId}
          refining={proposal !== null}
          disabled={!mayPropose}
        />
      )}

      {proposal ? (
        <ProposalReview organizationId={organizationId} proposal={proposal} />
      ) : (
        canDraft && (
          <EmptyState className="mt-6 max-w-2xl">
            Nothing is waiting to be reviewed.
          </EmptyState>
        )
      )}

      <ProposalHistory proposals={history.filter((entry) => entry.outcome !== 'draft')} />
    </>
  );
}
