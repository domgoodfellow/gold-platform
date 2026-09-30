import { Card } from '@/components/containers/card';
import { SectionHeading } from '@/components/containers/section';
import { DefinitionList, Detail } from '@/components/display/data';
import type { AcceptedProposalHandoff } from '@/lib/domain/customers/proposal-handoff';
import { previewByWorkspace, type ConfigurationRecommendation } from '@/lib/domain/customers/configuration-recommendation';

type CommercialTerms = {
  planLabel?: string;
  currency?: string;
  billingInterval?: string;
  addons?: { label?: string }[];
};

/**
 * "Where this business came from" — read straight off the handoff a business was founded from
 * (`getFoundingHandoff`), never recomputed. Every field here is a receipt of what Sales already
 * showed the prospect, not a live join (I8).
 *
 * **Deliberately inert.** The accepted Feature recommendation is discovery's own suggestion, not
 * a purchase — Sales determines what was bought (entitled automatically, at handoff, onto
 * `organization_plan_assignments`); this panel shows what discovery *suggested* with no control
 * attached, so Setup can never turn a Sales-time guess into a switched-on module by itself.
 */
export function FoundingHandoff({ handoff }: { handoff: AcceptedProposalHandoff }) {
  const terms = handoff.commercialTerms as CommercialTerms;
  const recommendation = handoff.acceptedConfiguration as ConfigurationRecommendation | null;
  const preview = recommendation ? previewByWorkspace(recommendation.recommended) : [];

  return (
    <Card as="section" aria-labelledby="founding-handoff-heading">
      <SectionHeading id="founding-handoff-heading">Where this business came from</SectionHeading>
      <p className="mt-1 text-sm text-muted">
        Created from an accepted proposal. {handoff.confirmedRequirements} discovery{' '}
        {handoff.confirmedRequirements === 1 ? 'question was' : 'questions were'} confirmed before it was sent.
      </p>

      {terms.planLabel ? (
        <DefinitionList className="mt-3">
          <Detail label={terms.planLabel}>{terms.currency} · {terms.billingInterval}</Detail>
          {(terms.addons ?? []).map((addon, index) => (
            <Detail key={index} label={addon.label ?? 'Add-on'}>
              Included
            </Detail>
          ))}
        </DefinitionList>
      ) : null}

      {handoff.unresolvedRequirements.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">Still to confirm</p>
          <ul className="mt-1 list-inside list-disc text-sm text-muted">
            {handoff.unresolvedRequirements.map((requirement) => (
              <li key={requirement.key}>{requirement.question}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">Suggested by discovery</p>
          <p className="text-sm text-muted">Nothing below has been switched on. Turn any of it on from the area it belongs to.</p>
          <div className="mt-2 divide-y divide-border rounded-md border border-border">
            {preview.map((workspace) => (
              <div key={workspace.workspace} className="px-3 py-2">
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
      ) : null}
    </Card>
  );
}
