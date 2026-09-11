import { DividedList, EmptyState, GroupHeading, Section, SectionHeading } from '@/components/containers/section';
import { AppPage } from '@/components/containers/app-page';
import { Hint } from '@/components/controls/inputs';
import Link from 'next/link';
import {
  canDraftConfiguration,
  currentConfigurationProposal,
  listConfigurationProposals,
} from '@/lib/domain/configuration/proposals';
import { computeReadiness } from '@/lib/domain/tenancy/lifecycle';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { AREAS, areaHref } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { DescribeForm, LaunchForm, ProposalHistory, ProposalReview } from './setup-forms';

/**
 * The screens a business fills in by hand, whether or not drafting is available on this
 * deployment — the same steps a proposal would have covered in one shot (D32), walked one at a
 * time instead. Curated rather than exhaustive: Customers, Automations, Assets and Custom
 * fields are just as real, but this is a starting checklist, not a second copy of the sidebar.
 */
const MANUAL_SETUP_SEGMENTS = ['work', 'resources', 'locations', 'pricing', 'roles', 'settings'] as const;

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
  const inSetup = organization.operationalState === 'setup';

  const [proposal, history, canDraft, enabledModules, readiness] = await Promise.all([
    currentConfigurationProposal(db, { organizationId }),
    listConfigurationProposals(db, { organizationId }),
    canDraftConfiguration(),
    // Only asked while there is a launch to gate — a live business has nothing here to compute.
    inSetup ? listUsableModules(db, { organizationId }) : Promise.resolve(new Set<string>()),
    inSetup ? computeReadiness(db, { organizationId }) : Promise.resolve(null),
  ]);

  // Asking for a proposal is its own authority; applying one is not, because every step of
  // applying is already gated by the capability that step needs (D32). So the Apply button is
  // shown to everybody and refused by the database — which is I12's rule, not a shortcut around
  // it: hiding it would make this screen the place that decides, and the policies would still be
  // the place that does. Launch follows the same shape below.
  const mayPropose = organization.capabilities.includes('configuration.propose');
  const mayLaunch = organization.capabilities.includes('organization.manage');

  const manualEntryPoints = MANUAL_SETUP_SEGMENTS.flatMap((segment) => {
    const area = AREAS.find((entry) => entry.segment === segment);
    if (!area) return [];
    if (area.module && !enabledModules.has(area.module)) return [];

    // Work's own definition — kinds of work, statuses, transitions, checklists — moved to
    // Settings in Slice 3 (product reality audit). The operational Work screen this used to
    // point at no longer has any of it to fill in, so the manual step now names where it
    // actually lives, reusing the same area's own label rather than inventing a second one.
    const href =
      segment === 'work'
        ? `${areaHref(organizationId, 'settings')}/work`
        : areaHref(organizationId, segment);

    return [{ segment, label: area.label, href }];
  });

  return (
    <AppPage width="standard">
      {/* **The one section that only shows while there is still a launch ahead of it.** Once
          this business is Live, everything below reverts to exactly what this page has always
          been — the drafting tool — because ordinary operation does not need a readiness
          checklist and the larger reorganisation of where setup lives afterwards is a later
          slice (product reality audit). */}
      {inSetup && readiness ? (
        <Section className="mt-6">
          <SectionHeading>Setting up {organization.name}</SectionHeading>
          <Hint className="mt-1">
            {readiness.blockers.length === 0
              ? 'Nothing is blocking a launch.'
              : `${readiness.blockers.length} thing${readiness.blockers.length === 1 ? '' : 's'} switched on and not working yet.`}
          </Hint>

          {readiness.blockers.length > 0 ? (
            <div className="mt-4">
              <GroupHeading>Blocking launch</GroupHeading>
              <DividedList className="mt-2">
                {readiness.blockers.map((item) => (
                  <li key={item.key} className="py-2 text-sm">
                    {item.message}{' '}
                    <Link href={item.area.href} className="underline underline-offset-4">
                      {item.area.label}
                    </Link>
                  </li>
                ))}
              </DividedList>
            </div>
          ) : null}

          {readiness.warnings.length > 0 ? (
            <div className="mt-4">
              <GroupHeading>Worth finishing, not blocking</GroupHeading>
              <DividedList className="mt-2">
                {readiness.warnings.map((item) => (
                  <li key={item.key} className="py-2 text-sm">
                    {item.message}{' '}
                    <Link href={item.area.href} className="underline underline-offset-4">
                      {item.area.label}
                    </Link>
                  </li>
                ))}
              </DividedList>
            </div>
          ) : null}

          {manualEntryPoints.length > 0 ? (
            <div className="mt-4">
              <GroupHeading>Configure it by hand</GroupHeading>
              <nav className="mt-2 flex flex-wrap gap-2" aria-label="Configuration screens">
                {manualEntryPoints.map((entry) => (
                  <Link
                    key={entry.segment}
                    href={entry.href}
                    className="rounded border border-border px-3 py-1 text-sm underline-offset-4 hover:underline"
                  >
                    {entry.label}
                  </Link>
                ))}
              </nav>
            </div>
          ) : null}

          <div className="mt-6 border-t border-border pt-4">
            {/* Shown to everybody who can launch and refused by the domain layer, which
                re-checks readiness itself rather than trusting this render (I12, and the same
                reasoning I6 gives for a free slot) — not disabled here, because the reasons it
                would refuse for are already the list above rather than something this button
                would be hiding. */}
            {mayLaunch ? (
              <LaunchForm organizationId={organizationId} />
            ) : (
              <Hint>Your role, {organization.role}, cannot launch this business.</Hint>
            )}
          </div>
        </Section>
      ) : null}

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
    </AppPage>
  );
}
