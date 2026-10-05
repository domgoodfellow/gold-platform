import { Section, SectionHeading } from '@/components/surfaces/section';

/**
 * Where an invalid, withdrawn or expired proposal link — or a session that has ended — lands. One
 * page for all of them: which one it was is not something a stranger should learn.
 */
export default function ProposalUnavailablePage() {
  return (
    <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Section>
        <SectionHeading>This proposal is no longer available</SectionHeading>
        <p className="mt-2 text-sm text-muted">
          The link may have been replaced or withdrawn, or your session may have ended. Ask the
          business that sent it for a new link.
        </p>
      </Section>
    </main>
  );
}
