import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import Link from 'next/link';

/**
 * GOLD's own front door.
 *
 * **This is not the marketing surface `constraints.md` D20 defers, and the two had been sharing
 * one word.** That record blocks marketing on the grounds that "every word on a public page a
 * business shows the world is a claim that business makes about itself" — which is true of a
 * *tenant's* site and is the reason a tenant's copy is a row in `organization_profiles`. It says
 * nothing about this page, where the business making the claim is GOLD. A per-tenant site with
 * pages and editable blocks stays deferred with its trigger unchanged; this speaks for the
 * platform, so `public-profile.test.ts` deliberately does not scan it.
 *
 * **It says only what is true today, and that is a rule rather than a stage of completion.**
 * The commercial model `vision.md` describes is three tiers — the management system, an AI
 * layer over the domain tools, the realtime communications plane — and two of them do not
 * exist: the automation runtime is M6, the AI layer is M8. A front door advertising either
 * would be selling something this repository cannot do, which is a worse failure than a thin
 * page. **No prices**, for the reason D8 keeps them out of `docs/`: they are the least durable
 * claim this platform makes and the first three sales calls will move them. A number on a
 * public page is a promise; the layering is architecture and is safe to state.
 *
 * There is deliberately **no link into the operator shell**. This page had one to
 * `/organizations` since M1, back when it was the only other route that existed, and it read
 * as a front door offering strangers a way into somebody's business. The way in is signing in.
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
          {/*
            Two doors onto one `createOrganization`, and a door opens where somebody is on
            the far side of it doing the configuring (D29). A new business here is genuinely
            empty — no statuses, no types, no hours, because the platform inventing them is the
            thing this product refuses — so handing the emptiness to a stranger with nothing to
            fill it is not a product. Today the somebody is a person, which is why this says
            *get in touch* rather than showing a sign-up form. When M8's onboarding flow can
            take a description of a business and propose its configuration, the self-serve door
            opens onto the same function and this paragraph changes with it.
          */}
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
