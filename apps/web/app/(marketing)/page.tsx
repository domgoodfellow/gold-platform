import Link from 'next/link';
import {
  Bot,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  Phone,
  SlidersHorizontal,
  ToggleLeft,
  Users,
} from 'lucide-react';

const BUILT_ON = ['Stripe', 'Twilio', 'Resend', 'Anthropic'];

/**
 * GOLD's own front door — not the tenant marketing surface D20 defers, since the business
 * making claims here is GOLD itself, not a tenant (`public-profile.test.ts` doesn't scan it).
 * Says only what's true today: no prices (D8), nothing about layers that don't exist yet, and
 * no fake "trusted by" wall — the integrations strip below names the four vendors actually in
 * `apps/api/app/integrations/`, nothing aspirational.
 *
 * No button of its own reaches `/login` — `(marketing)/layout.tsx` already puts "Log in" in
 * the header on every page here, so a second one in the hero would be the same action twice.
 * The closing section's "Get started" points at `/sign-up`, a real working door (self-serve
 * founding reopened, `20260901000001`) — not an invented contact form or a fabricated address,
 * which would have been worse than the dead-end prose it replaces (product reality audit, Slice E).
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-16 py-4 sm:gap-20 sm:py-6">
      {/* Hero */}
      <section className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between sm:gap-12">
        <div className="flex max-w-xl flex-col gap-6">
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Your business isn&rsquo;t the problem. Your spreadsheet is.
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-muted">
            GOLD replaces the spreadsheet, the shared calendar and the group chat holding your
            business together with one place that books the job, keeps the schedule honest and
            gets you paid — set up around how you already work, not a template you bend to fit.
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-3 sm:pt-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            What you&rsquo;re running today
          </p>
          <ul className="flex flex-col gap-2 text-sm text-subtle">
            <li className="line-through decoration-1">A spreadsheet</li>
            <li className="line-through decoration-1">A shared calendar</li>
            <li className="line-through decoration-1">A group chat</li>
          </ul>
          <p className="text-sm font-semibold text-foreground">One system that runs it</p>
        </div>
      </section>

      {/* What it's built on — real vendors, not a "trusted by" wall */}
      <section className="flex flex-col gap-4 border-y border-border py-5 sm:flex-row sm:items-center sm:gap-10">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-subtle">
          What it&rsquo;s built on
        </p>
        <div
          className="min-w-0 flex-1 overflow-hidden"
          style={{
            maskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)',
            WebkitMaskImage:
              'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)',
          }}
        >
          <div
            className="flex w-max items-center gap-12"
            style={{ animation: 'marquee 22s linear infinite' }}
          >
            {[...BUILT_ON, ...BUILT_ON].map((name, index) => (
              <span
                key={`${name}-${index}`}
                className="text-lg font-semibold tracking-tight text-subtle"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* The shell, illustrated rather than screenshotted — the real one carries a business's own words, which this can't. */}
      <section className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-lg border border-border shadow-sm">
          <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[180px_1fr]">
            <div className="hidden flex-col gap-1 border-r border-border p-3 sm:flex">
              {[
                { label: 'Today', icon: LayoutDashboard, current: true },
                { label: 'Work', icon: ClipboardCheck, current: false },
                { label: 'Schedule', icon: CalendarDays, current: false },
                { label: 'Customers', icon: Users, current: false },
                { label: 'Calls', icon: Phone, current: false },
                { label: 'Ask', icon: Bot, current: false },
              ].map(({ label, icon: Icon, current }) => (
                <div
                  key={label}
                  className={
                    current
                      ? 'flex items-center gap-2 rounded bg-foreground px-2.5 py-1.5 text-sm font-medium text-background'
                      : 'flex items-center gap-2 rounded px-2.5 py-1.5 text-sm text-muted'
                  }
                >
                  <Icon aria-hidden size={16} className="shrink-0" />
                  {label}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 p-5">
              <p className="text-sm font-semibold">Today</p>
              {[180, 140, 210, 120].map((width, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded border border-border px-3 py-2.5"
                >
                  <div className="h-2.5 rounded-full bg-foreground/10" style={{ width }} />
                  <div className="h-4 w-14 shrink-0 rounded border border-border bg-foreground/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="max-w-md text-sm text-subtle">
          The shape of the operator shell — the real one has your business&rsquo;s own words on
          it, not ours.
        </p>
      </section>

      {/* Three pillars */}
      <section className="grid gap-10 sm:grid-cols-3">
        <div className="flex flex-col gap-3 border-t-2 border-foreground pt-5">
          <SlidersHorizontal aria-hidden size={22} />
          <h2 className="text-lg font-semibold">
            Shaped like your business, not the other way around
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            Your statuses, your prices, your hours, your forms. Nobody asks you to change how you
            run things to fit the software — and nobody writes you a line of code to get there.
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t-2 border-foreground pt-5">
          <ClipboardCheck aria-hidden size={22} />
          <h2 className="text-lg font-semibold">
            Nothing gets double-booked. Nobody chases a cheque.
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            One schedule that refuses to overlap, a booking page your customers use themselves,
            and invoices that go out and get tracked — without you doing the tracking.
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t-2 border-foreground pt-5">
          <ToggleLeft aria-hidden size={22} />
          <h2 className="text-lg font-semibold">Pay for what you turn on</h2>
          <p className="text-sm leading-relaxed text-muted">
            Billing, assets, booking, card payments — switch on what you need. Invoice somewhere
            else already? Keep doing that, and pay for the rest.
          </p>
        </div>
      </section>

      {/* Growth path */}
      <section className="rounded-2xl bg-foreground px-6 py-10 text-background sm:px-10 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-wide text-background/50">
          How this actually plays out
        </p>
        <h2 className="mt-3 max-w-lg text-2xl font-semibold sm:text-3xl">
          Most businesses buy this three times, not once.
        </h2>

        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-background/45">01</p>
            <h3 className="text-base font-semibold">Get off paper</h3>
            <p className="text-sm leading-relaxed text-background/70">
              Right now it&rsquo;s a booking inbox, a shared calendar, a group chat — and it holds
              together because someone remembers. This is the part that changes first.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-background/45">02</p>
            <h3 className="text-base font-semibold">Let it run itself a little</h3>
            <p className="text-sm leading-relaxed text-background/70">
              A year in, the system that felt modern starts to feel like the old way. Rules
              answer a customer without anyone watching; an assistant works the same tools your
              team does.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-background/45">03</p>
            <h3 className="text-base font-semibold">Make it look like you own the place</h3>
            <p className="text-sm leading-relaxed text-background/70">
              Same customer, later: a site and a brand that shows up everywhere a customer looks
              — the booking page, the portal, the invoice.
            </p>
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="flex flex-col gap-4 pb-4">
        <h2 className="max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
          We build it with you. You don&rsquo;t touch a settings screen until it&rsquo;s already
          right.
        </h2>
        <p className="max-w-md text-muted">
          Get in touch and we will configure it against how you actually work — or start now and
          shape it as you go.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* Self-serve founding is open (`20260901000001`, revisiting D29) — this is a real,
              working door, not a promise, so the closing section has a next step for a visitor
              who isn't a customer yet rather than only "Log in" for one who already is. */}
          <Link
            href="/sign-up"
            className="text-sm font-medium underline underline-offset-4"
          >
            Get started
          </Link>
          <Link href="/login" className="inline-block w-fit text-sm font-medium underline underline-offset-4">
            Log in
          </Link>
        </div>
      </section>
    </div>
  );
}
