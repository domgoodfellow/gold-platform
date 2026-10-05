import { Section, SectionHeading } from '@/components/surfaces/section';

/**
 * Where an invalid, withdrawn, switched-off or expired portal link — or a session that has ended —
 * lands. One page for all of them: which one it was is not something a stranger should learn.
 */
export default function PortalUnavailablePage() {
  return (
    <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Section>
        <SectionHeading>This link no longer works</SectionHeading>
        <p className="mt-2 text-sm text-muted">
          It may have been replaced, withdrawn, or your session may have ended. Ask the business
          for a new link.
        </p>
      </Section>
    </main>
  );
}
