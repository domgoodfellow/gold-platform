import { SectionHeading } from '@/components/surfaces/section';
import { ErrorText } from '@/components/controls/inputs';
import type { ConfigurationProposal } from '@/lib/domain/configuration/proposals';

/**
 * What has been proposed before, and what happened to it.
 *
 * A failed apply is the row that earns this section. `configureBusiness` is not atomic, so a
 * failure leaves a business part-way configured — and the honest thing is to say which step
 * refused, in the words the database or the domain layer used, beside what the business turned
 * out to have afterwards.
 */
export function ProposalHistory({ proposals }: { proposals: ConfigurationProposal[] }) {
  if (proposals.length === 0) return null;

  return (
    <section className="mt-10 border-t border-border pt-4">
      <SectionHeading>What has been proposed before</SectionHeading>
      <ul className="mt-2 space-y-3">
        {proposals.map((proposal) => (
          <li key={proposal.id} className="text-sm">
            <span className="text-subtle">
              {new Date(proposal.createdAt).toLocaleString()} · {proposal.outcome} · drafted by{' '}
              {proposal.draftedBy}
            </span>
            <p className="mt-1 max-w-2xl whitespace-pre-wrap opacity-80">{proposal.description}</p>
            {proposal.outcome === 'applying' ? <p className="mt-1 text-muted">Applying started. If it stopped part-way, check what was saved before starting a new draft.</p> : null}
            {proposal.detail && (
              <ErrorText className="mt-1 max-w-2xl">
                Stopped part-way: {proposal.detail}
              </ErrorText>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
