import { Section, SectionHeading } from '@/components/surfaces/section';

/**
 * Where a processor sends a payer back — deliberately named with no token in its path.
 *
 * A checkout redirect is not proof of payment (the webhook is authoritative, D26/D27), and this
 * page carries nothing that needs to be — no invoice, no amount, no "success". Its only real job
 * is to *not* be `/portal/{token}`: that token is this customer's whole credential, and handing
 * it to a processor as a `success_url`/`cancel_url` would disclose a bearer-like secret to a
 * third party for no reason this page needs to. A customer who wants to see their invoice's
 * actual standing reopens the link the business sent them, the same one they used to get here.
 */
export default function PortalPaymentReturnPage() {
  return (
    <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Section>
        <SectionHeading>Payment submitted</SectionHeading>
        <p className="mt-2 text-sm text-muted">
          This will show as paid once the processor confirms it. Reopen the link the business
          sent you to see your invoice&rsquo;s current standing.
        </p>
      </Section>
    </main>
  );
}
