import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import Link from 'next/link';

/**
 * GOLD's own front door — not the tenant marketing surface D20 defers, since the business
 * making claims here is GOLD itself, not a tenant (`public-profile.test.ts` doesn't scan it).
 * Says only what's true today: no prices (the least durable claim, and D8's reasoning for
 * keeping them out of docs too), and nothing about layers that don't exist yet (M6, M8). No
 * link into the operator shell — that's what signing in is for.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 p-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">GOLD</h1>
        <p className="mt-3 text-lg opacity-80">
          One engine. Many businesses. Configuration, not forks.
        </p>
      </header>

      <section className="grid gap-6 sm:grid-cols-3">
        <div>
          <SectionHeading>One shape per business</SectionHeading>
          <Hint className="mt-1">
            Your work, your statuses, your fields, your prices, your hours — configured, not
            coded. No migration and no deploy to stand a business up.
          </Hint>
        </div>
        <div>
          <SectionHeading>Booked, scheduled, worked, paid</SectionHeading>
          <Hint className="mt-1">
            A public booking page, a schedule nothing can double-book, quotes and invoices, and
            a portal your customers sign in to.
          </Hint>
        </div>
        <div>
          <SectionHeading>Only what you switch on</SectionHeading>
          <Hint className="mt-1">
            Billing, assets, booking, the portal, card payments. A business that invoices
            somewhere else runs without that half and keeps everything it recorded.
          </Hint>
        </div>
      </section>

      <section>
        <Hint>
          {/* Two doors onto one `createOrganization` (D29) — the self-serve door isn't open yet, since a new business here starts genuinely empty and handing that to a stranger isn't a product yet. */}
          We set your business up with you. Get in touch and we will configure it against how
          you actually work.
        </Hint>
        <Link
          href="/sign-in"
          className="mt-4 inline-block text-sm underline underline-offset-4"
        >
          Sign in
        </Link>
      </section>
    </main>
  );
}
