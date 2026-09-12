import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarDays, ClipboardList, MessageSquare, Users } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { FOCUS_RING, cx } from '@/components/class-names';
import { canonicalUrl } from '@/lib/seo/site';

export const metadata: Metadata = {
  title: 'GOLD | One operating system for your business',
  description:
    'Connect work, customers, scheduling, communications, payments and automation in one configurable business system.',
  alternates: { canonical: '/' },
};

const CAPABILITIES = [
  ['Run the work', 'Keep jobs, scheduling, resources, customers and locations connected from request to completion.'],
  ['Keep the history', 'Calls, messages, job updates, invoices and payments stay with the customer they concern.'],
  ['Configure the operation', 'Use your own work types, stages, pricing, hours and roles without creating another application.'],
  ['Automate deliberately', 'Let rules handle defined steps and keep consequential decisions reviewable by a person.'],
  ['Meet customers cleanly', 'Offer booking and a customer portal in the business’s own name, words and brand.'],
  ['See what needs attention', 'Start with today’s commitments and exceptions, then move into reports when the question needs more.'],
] as const;

const IMPLEMENTATION = [
  ['01', 'Understand the workflow', 'Map how work arrives, moves, gets scheduled and gets paid today.'],
  ['02', 'Configure the business', 'Set up the operation’s real services, stages, prices, hours and responsibilities.'],
  ['03', 'Review and launch', 'Test the complete path, resolve what is missing, and launch only when the business approves it.'],
  ['04', 'Improve over time', 'Add integrations, automation and new capabilities without replacing the foundation.'],
] as const;

function ProductPreview() {
  const rows = [
    ['09:00', 'Install · Reyes', 'Van 2'],
    ['11:30', 'Inspection · Okafor', 'Van 1'],
    ['14:00', 'Repair · Nguyen', 'Bay 2'],
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold">Today</span>
        <span className="font-mono text-xs text-subtle">Example configuration</span>
      </div>
      <div className="grid sm:grid-cols-[150px_1fr]">
        <nav aria-label="Product preview" className="hidden border-r border-border p-3 sm:block">
          {[
            [CalendarDays, 'Today'],
            [ClipboardList, 'Work'],
            [Users, 'Customers'],
            [MessageSquare, 'Calls'],
          ].map(([Icon, label], index) => (
            <div
              key={label as string}
              className={cx(
                'flex items-center gap-2 rounded px-2.5 py-2 text-xs',
                index === 0 ? 'bg-foreground font-medium text-background' : 'text-muted',
              )}
            >
              <Icon aria-hidden size={14} />
              {label as string}
            </div>
          ))}
        </nav>
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="border-t-2 border-foreground pt-3">
              <p className="text-xs text-muted">Committed today</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">6</p>
            </div>
            <div className="border-t-2 border-foreground pt-3">
              <p className="text-xs text-muted">Waiting to schedule</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">2</p>
            </div>
          </div>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {rows.map(([time, work, resource]) => (
              <div key={`${time}-${work}`} className="grid grid-cols-[3.5rem_1fr] gap-3 py-3 text-xs sm:grid-cols-[3.5rem_1fr_auto]">
                <span className="font-mono text-subtle">{time}</span>
                <span className="font-medium">{work}</span>
                <span className="hidden text-muted sm:block">{resource}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const home = canonicalUrl('/').toString();
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${home}#organization`, name: 'GOLD', url: home },
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        name: 'GOLD',
        url: home,
        publisher: { '@id': `${home}#organization` },
      },
      {
        '@type': 'WebPage',
        '@id': home,
        name: 'GOLD | One operating system for your business',
        description:
          'Connect work, customers, scheduling, communications, payments and automation in one configurable business system.',
        isPartOf: { '@id': `${home}#website` },
        about: { '@id': `${home}#organization` },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-24 py-6 sm:gap-32 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />

      <section className="grid gap-12 lg:grid-cols-[1fr_460px] lg:items-center lg:gap-16">
        <div className="flex flex-col items-start gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Configurable business operations</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
            Your business, operating as one system.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            GOLD connects the work, customers, schedule, conversations and money that small
            operations businesses manage across disconnected tools today—then configures the
            system around how the business actually runs.
          </p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
            <ButtonLink href="/workflow-review" tone="primary">Request a workflow review</ButtonLink>
            <a href="#how-it-works" className={cx('rounded text-sm font-medium text-muted hover:text-foreground', FOCUS_RING)}>
              See how GOLD works
            </a>
          </div>
        </div>
        <ProductPreview />
      </section>

      <section className="grid gap-10 border-y border-border py-12 lg:grid-cols-[0.7fr_1fr] lg:gap-20">
        <h2 className="max-w-md text-2xl font-semibold tracking-tight sm:text-3xl">
          The problem is not one bad tool. It is the space between all of them.
        </h2>
        <div className="grid gap-5 text-sm leading-relaxed text-muted sm:grid-cols-2">
          <p>A spreadsheet knows the customer but not the appointment. A calendar knows the time but not the price. A phone holds the conversation but not the work it changed.</p>
          <p>GOLD gives those facts one operational home, so the next action starts with the same customer, work and history instead of another round of copying.</p>
        </div>
      </section>

      <section id="capabilities" className="scroll-mt-24">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">The platform</p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">One foundation, configured around the operation.</h2>
          <p className="text-muted">Start with the parts the business needs. Add more without splitting customer and work history into another system.</p>
        </div>
        <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(([name, body]) => (
            <article key={name} className="border-t-2 border-foreground pt-4">
              <h3 className="font-semibold">{name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24">
        <div className="grid gap-10 lg:grid-cols-[0.7fr_1fr] lg:gap-20">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Implementation</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Configured with the business, not dropped at the door.</h2>
          </div>
          <ol className="divide-y divide-border border-y border-border">
            {IMPLEMENTATION.map(([step, title, body]) => (
              <li key={step} className="grid gap-2 py-5 sm:grid-cols-[3rem_12rem_1fr] sm:gap-4">
                <span className="font-mono text-xs text-subtle">{step}</span>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid gap-8 rounded-xl border border-border bg-surface p-6 sm:p-10 lg:grid-cols-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Built for trust</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Control stays explicit.</h2>
        </div>
        <div className="grid gap-8 text-sm leading-relaxed text-muted sm:grid-cols-2 lg:col-span-2">
          {[
            ['One tenant boundary', 'Organization data stays organization-scoped from the screen through the database.'],
            ['Human review where it matters', 'AI can draft and assist; it does not silently publish content or take consequential action.'],
            ['Your operation, not a fork', 'Configuration represents the differences between businesses while the platform stays maintainable.'],
            ['A deliberate launch', 'Readiness is visible, reviewable and approved before the business goes live.'],
          ].map(([title, body]) => (
            <div key={title}>
              <h3 className="font-semibold text-foreground">{title}</h3>
              <p className="mt-2">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="-mx-4 rounded-xl bg-foreground px-6 py-14 text-background sm:-mx-6 sm:px-12">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">Start with the workflow that is holding the business back.</h2>
          <p className="max-w-xl opacity-75">A workflow review maps the current operation and identifies where one connected system can remove repeated work, missed handoffs and invisible commitments.</p>
          <ButtonLink href="/workflow-review" className="!inline-flex items-center gap-2 !bg-background !text-foreground">
            Request a workflow review <ArrowRight aria-hidden size={16} />
          </ButtonLink>
          <p className="text-sm opacity-75">
            Prefer to explore independently? <Link href="/sign-up" className="font-medium underline underline-offset-4">Create an account</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
