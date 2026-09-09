import Link from 'next/link';
import { CalendarDays, ClipboardList, LayoutDashboard, Settings, Users } from 'lucide-react';
import { Badge } from '@/components/display/data';
import { ButtonLink } from '@/components/controls/button';

const BUILT_ON = ['Stripe', 'Twilio', 'Resend', 'Anthropic'];

/**
 * GOLD's own front door — not the tenant marketing surface D20 defers, since the business
 * making claims here is GOLD itself, not a tenant (`public-profile.test.ts` doesn't scan it).
 *
 * **Rebuilt for what the product now actually is** (product reality audit, Slice 4), after four
 * slices gave GOLD a real lifecycle (SETUP → readiness → Launch → LIVE), a real cockpit (Today),
 * a real Configuration Center (Settings) and a real split between operating Work and defining
 * it. This page sells that — the configured system, and the review that gets a business one —
 * never the platform's own internal naming for how it is built, and never the order in which
 * this document's own commercial reasoning expects one customer to buy successive pieces. Those
 * belong to `docs/`, not to somebody deciding whether to get in touch.
 *
 * **The primary CTA now has a real destination.** "Request a workflow review" (`market.md`'s own
 * three reasons a business buys, read as an offer rather than a sales script) leads to
 * `/workflow-review`, a form that writes an ordinary customer into GOLD's own tenant
 * (`lib/domain/workflow-review/workflow-review.ts`) rather than to a fabricated inbox or a
 * signup form standing in for it.
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-16 py-4 sm:gap-20 sm:py-6">
      {/* Hero */}
      <section className="flex flex-col gap-6">
        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          Your business isn&rsquo;t the problem. Running it from five different places is.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted">
          Small operations businesses run real work — jobs, schedules, customers, payments — split
          across a spreadsheet, a calendar, a phone and a few tools that don&rsquo;t talk to each
          other. GOLD is one configured system that reflects how you already work, built with you
          rather than bent to fit a template.
        </p>

        {/* Primary, then the two doors that already exist today — never presented as equals
            (product reality audit, Slice 4: self-service is real but not the primary motion). */}
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <ButtonLink href="/workflow-review" tone="primary">
            Request a workflow review
          </ButtonLink>
          <p className="text-sm text-muted">
            Already have an account?{' '}
            <Link href="/login" className="underline underline-offset-4">
              Log in
            </Link>
          </p>
        </div>
        <p className="text-sm text-subtle">
          Want to explore on your own first?{' '}
          <Link href="/sign-up" className="underline underline-offset-4">
            Start here
          </Link>
          .
        </p>
      </section>

      {/* Current problem — fragmentation, not a spreadsheet grudge */}
      <section id="problem" className="flex flex-col gap-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Where it stands today
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Customer details', 'a phone, an inbox, or an old spreadsheet'],
            ['The schedule', 'a shared calendar nobody fully trusts'],
            ['Job status', 'in someone’s head, or a whiteboard'],
            ['Getting paid', 'invoices written by hand, chased by text'],
            ['Customer conversations', 'scattered across calls, texts and email'],
          ].map(([what, where]) => (
            <div
              key={what}
              className="flex items-baseline justify-between gap-3 rounded border border-border px-4 py-3 text-sm"
            >
              <span className="font-medium">{what}</span>
              <span className="text-right text-subtle line-through decoration-1">{where}</span>
            </div>
          ))}
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          None of these tools is wrong on its own. The problem is that no one of them knows what
          the others are doing. GOLD&rsquo;s promise isn&rsquo;t replacing any single one of them
          — it&rsquo;s putting the whole operation in one place that stays coordinated.
        </p>
      </section>

      {/* Product example — grounded in the real shell, not generic SaaS chrome */}
      <section id="example" className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Example: a field-service business configured in GOLD
        </p>
        <div className="overflow-hidden rounded-lg border border-border shadow-sm">
          <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[180px_1fr]">
            <div className="hidden flex-col gap-1 border-r border-border p-3 sm:flex">
              {[
                { label: 'Today', icon: LayoutDashboard, current: true },
                { label: 'Work', icon: ClipboardList, current: false },
                { label: 'Schedule', icon: CalendarDays, current: false },
                { label: 'Customers', icon: Users, current: false },
                { label: 'Settings', icon: Settings, current: false },
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
            <div className="flex flex-col gap-3 p-5">
              <p className="text-sm font-semibold">Today</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { title: 'Committed today', value: '6', note: '09:00 Van 2 · Install, Reyes' },
                  { title: 'Waiting to be scheduled', value: '2', note: 'Gutter clean · Okafor' },
                  { title: 'Recent activity', value: null, note: 'Invoice #41 issued' },
                ].map((widget) => (
                  <div key={widget.title} className="rounded border border-border p-3">
                    <p className="truncate text-xs font-medium text-muted">{widget.title}</p>
                    {widget.value ? (
                      <p className="mt-1 text-xl font-semibold tabular-nums">{widget.value}</p>
                    ) : null}
                    <p className="mt-1 truncate text-xs text-subtle">{widget.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="max-w-md text-sm text-subtle">
          This is one example business, configured in GOLD. The screens stay the same for every
          business — what changes is the work inside them: your own customers, your own jobs,
          your own work types and statuses, set up around how you already run things.
        </p>
      </section>

      {/* What GOLD can handle — capability families, not a feature checklist */}
      <section id="capabilities" className="flex flex-col gap-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          What a configured system can cover
        </p>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              name: 'Operations',
              body: 'Work, scheduling, resources, customers, locations and assets — the day-to-day, in one place.',
            },
            {
              name: 'Communications',
              body: 'Calls logged against the right customer, with the history there when you pick up.',
            },
            {
              name: 'Money',
              body: 'A price book, quotes, invoices and payments — the numbers a job actually turns on.',
            },
            {
              name: 'Automation',
              body: 'Rules that move work on and messages that go out, in your own words, when something you defined happens.',
            },
            {
              name: 'Customer-facing',
              body: 'A booking page and a customer portal carrying your name and your brand, not ours.',
            },
            {
              name: 'Insight',
              body: 'A daily view of what’s committed, what’s waiting and what changed, plus reports when you want more.',
            },
          ].map((capability) => (
            <div key={capability.name} className="flex flex-col gap-2 border-t-2 border-foreground pt-4">
              <h3 className="text-base font-semibold">{capability.name}</h3>
              <p className="text-sm leading-relaxed text-muted">{capability.body}</p>
            </div>
          ))}
        </div>
        <p className="max-w-xl text-sm text-muted">
          You switch on what your business uses and pay for that — not a bundle of everything
          above, and not a stripped-down tier of it either.
        </p>
      </section>

      {/* How implementation works — the real motion, honestly paced */}
      <section id="how-it-works" className="flex flex-col gap-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          How implementation works
        </p>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: '01',
              title: 'Understand the workflow',
              body: 'We start with how your business actually runs today — the jobs, the schedule, who does what.',
            },
            {
              step: '02',
              title: 'Configure the business',
              body: 'Work types, statuses, pricing, hours and roles get set up around that — nothing forced into a template.',
            },
            {
              step: '03',
              title: 'Review and launch',
              body: 'You see exactly what’s been set up and what still needs attention before anything goes live. Launching is a decision you make, not something that happens on its own.',
            },
            {
              step: '04',
              title: 'Improve over time',
              body: 'Switch on more of the system, add rules, adjust as the business changes — the same configuration, not a new one.',
            },
          ].map((phase) => (
            <div key={phase.step} className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-subtle">{phase.step}</p>
              <h3 className="text-base font-semibold">{phase.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{phase.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Automation / AI progression — capability, not a hype ladder. Delegate is the one stage
          not yet real, and it says so once rather than with a badge on every line. */}
      <section id="automation" className="flex flex-col gap-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          How much runs on its own is up to you
        </p>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {[
            {
              name: 'Record',
              body: 'The system captures the work, the calls and the customer history as it happens.',
              available: true,
            },
            {
              name: 'Understand',
              body: 'Reports and plain-language questions expose what’s actually going on.',
              available: true,
            },
            {
              name: 'Assist',
              body: 'A suggestion for the next step, with your own approval before anything changes.',
              available: true,
            },
            {
              name: 'Automate',
              body: 'Rules act on their own when something you defined happens, and messages go out in your own words.',
              available: true,
            },
            {
              name: 'Delegate',
              body: 'A voice agent handling bounded calls on its own.',
              available: false,
            },
          ].map((stage) => (
            <div key={stage.name} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">{stage.name}</h3>
                <Badge tone={stage.available ? 'neutral' : 'accent'}>
                  {stage.available ? 'Available today' : 'Direction'}
                </Badge>
              </div>
              <p className="text-sm leading-relaxed text-muted">{stage.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Platform / integration trust — subordinate, real vendors only */}
      <section className="flex flex-col gap-4 border-y border-border py-5 sm:flex-row sm:items-center sm:gap-10">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-subtle">
          Built on
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
                className="text-base font-medium tracking-tight text-subtle"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section id="review" className="flex flex-col gap-4 pb-4 scroll-mt-6">
        <h2 className="max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
          A workflow review is a conversation about how your business runs today.
        </h2>
        <p className="max-w-md text-muted">
          From there: we configure GOLD around it, you review exactly what&rsquo;s been set up,
          and you launch when it&rsquo;s ready — never before.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <ButtonLink href="/workflow-review" tone="primary">
            Request a workflow review
          </ButtonLink>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/login" className="text-sm font-medium underline underline-offset-4">
            Already have an account? Log in
          </Link>
          <Link href="/sign-up" className="text-sm font-medium underline underline-offset-4">
            Want to explore on your own? Start here
          </Link>
        </div>
      </section>
    </div>
  );
}
