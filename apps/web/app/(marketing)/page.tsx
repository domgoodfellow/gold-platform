'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Settings,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/display/data';
import { Button, ButtonLink } from '@/components/controls/button';
import { FOCUS_RING, cx } from '@/components/class-names';

const BUILT_ON = ['Stripe', 'Twilio', 'Resend', 'Anthropic'];

const NAV_ICONS = [LayoutDashboard, ClipboardList, CalendarDays, Users, Settings];

const TENANTS = [
  {
    key: 'field',
    icon: Truck,
    name: 'Field service',
    nav: [
      { label: 'Today' },
      { label: 'Work' },
      { label: 'Schedule' },
      { label: 'Customers' },
      { label: 'Settings' },
    ],
    widgets: [
      { title: 'Committed today', value: '6', note: '09:00 Van 2 · Install, Reyes' },
      { title: 'Waiting to be scheduled', value: '2', note: 'Gutter clean · Okafor' },
      { title: 'Recent activity', value: null, note: 'Invoice #41 issued' },
    ],
  },
  {
    key: 'mechanic',
    icon: Wrench,
    name: 'Mobile mechanic',
    nav: [
      { label: 'Today' },
      { label: 'Jobs' },
      { label: 'Schedule' },
      { label: 'Customers' },
      { label: 'Settings' },
    ],
    widgets: [
      { title: 'Committed today', value: '5', note: '09:00 Bay 2 · Brake job, Nguyen' },
      { title: 'Waiting to be scheduled', value: '3', note: 'Diagnostic · Alvarez' },
      { title: 'Recent activity', value: null, note: 'Invoice #118 paid' },
    ],
  },
  {
    key: 'property',
    icon: Building2,
    name: 'Property management',
    nav: [
      { label: 'Today' },
      { label: 'Units' },
      { label: 'Maintenance' },
      { label: 'Tenants' },
      { label: 'Settings' },
    ],
    widgets: [
      { title: 'Open requests', value: '4', note: 'Unit 12B · Leak reported' },
      { title: 'Leases renewing', value: '2', note: 'Unit 4A · renewal coming up' },
      { title: 'Recent activity', value: null, note: 'Rent posted · Unit 7' },
    ],
  },
] as const;

type Tenant = (typeof TENANTS)[number];

const STAGES = [
  {
    name: 'Record',
    available: true,
    body: 'The system captures the work, the calls and the customer history as it happens.',
    detail:
      'Every call, message and job update lands against the right customer automatically — nothing typed twice.',
  },
  {
    name: 'Understand',
    available: true,
    body: 'Reports and plain-language questions expose what’s actually going on.',
    detail:
      '"Which jobs are behind schedule this week?" — answered from the same data, no spreadsheet export required.',
  },
  {
    name: 'Assist',
    available: true,
    body: 'A suggestion for the next step, with your own approval before anything changes.',
    detail: 'GOLD proposes a reschedule, a follow-up message, or a price. You approve it, or you don’t.',
  },
  {
    name: 'Automate',
    available: true,
    body: 'Rules act on their own when something you defined happens, and messages go out in your own words.',
    detail:
      'Job marked complete → invoice sent → review request sent, written in your voice, without you touching it.',
  },
  {
    name: 'Delegate',
    available: false,
    body: 'A voice agent handling bounded calls on its own.',
    detail:
      'Incoming call → customer matched → work item found → schedule checked → response sent, before a human picks up.',
  },
] as const;

const CAPABILITIES = [
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
] as const;

const IMPLEMENTATION = [
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
    body: 'You see exactly what’s been set up and what still needs attention. Launching is a decision you make.',
  },
  {
    step: '04',
    title: 'Improve over time',
    body: 'Switch on more of the system, add rules, adjust as the business changes — the same configuration, not a new one.',
  },
] as const;

/**
 * A compact, non-interactive rendering of the app shell — reused by the hero (fixed to Field
 * service) and by the tenant switcher below it (driven by the selected tab). Same skeleton
 * every time; only the nav labels and widget data change, which is the whole thesis.
 */
function ShellPreview({ tenant, live }: { tenant: Tenant; live?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-xs text-subtle">Today · {tenant.name}</span>
        {live ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-subtle">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foreground" />
            </span>
            Live
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-[auto_1fr]">
        <div className="hidden flex-col gap-1 border-r border-border p-3 sm:flex">
          {tenant.nav.map((item, i) => {
            const Icon = NAV_ICONS[i];
            return (
              <div
                key={item.label}
                className={
                  i === 0
                    ? 'flex items-center gap-2 rounded bg-foreground px-2.5 py-1.5 text-xs font-medium text-background'
                    : 'flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-muted'
                }
              >
                <Icon aria-hidden size={14} className="shrink-0" />
                {item.label}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 p-4">
          {tenant.widgets.map((widget) => (
            <div key={widget.title} className="rounded border border-border p-3">
              <p className="truncate text-xs font-medium text-muted">{widget.title}</p>
              {widget.value ? (
                <p className="mt-1 text-lg font-semibold tabular-nums">{widget.value}</p>
              ) : null}
              <p className="mt-1 truncate text-xs text-subtle">{widget.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [tenantIndex, setTenantIndex] = useState(0);
  const [stageIndex, setStageIndex] = useState(3);
  const tenant = TENANTS[tenantIndex];
  const stage = STAGES[stageIndex];

  return (
    <div className="flex flex-col gap-24 py-6 sm:gap-32 sm:py-10">
      {/* Hero */}
      <section className="grid gap-10 lg:grid-cols-[1fr_440px] lg:items-center lg:gap-16">
        <div className="flex flex-col gap-6">
          <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Your business, operating as one system.
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-muted">
            Work, customers, calls, scheduling, payments and automation — split today across a
            spreadsheet, a calendar and a phone. GOLD configures them around how your business
            actually runs.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ButtonLink href="/workflow-review" tone="primary">
              Request a workflow review
            </ButtonLink>
            <a
              href="#shell"
              className={cx('rounded text-sm font-medium text-muted hover:text-foreground', FOCUS_RING)}
            >
              See GOLD in action
            </a>
          </div>
          <p className="text-sm text-subtle">
            Already have an account?{' '}
            <Link href="/login" className="underline underline-offset-4">
              Log in
            </Link>
          </p>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-10 -z-10 rounded-full bg-foreground opacity-[0.05] blur-3xl motion-safe:animate-[panel-glow_6s_ease-in-out_infinite]"
          />
          <div className="motion-safe:animate-[panel-in_0.6s_ease-out]">
            <ShellPreview tenant={TENANTS[0]} live />
          </div>
        </div>
      </section>

      {/* Same shell, different businesses — the interactive proof, not a paragraph */}
      <section id="shell" className="flex scroll-mt-20 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Same shell. Configured differently.
          </h2>
          <p className="max-w-lg text-muted">
            The screens stay the same from business to business — only the work inside them
            changes. Below is one example business, shown three ways it could be configured.
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Example businesses">
          {TENANTS.map((t, i) => {
            const Icon = t.icon;
            const active = i === tenantIndex;
            return (
              <Button
                key={t.key}
                type="button"
                tone="secondary"
                role="tab"
                aria-selected={active}
                onClick={() => setTenantIndex(i)}
                className={cx(
                  '!rounded-full flex items-center gap-2 text-sm font-medium transition-colors',
                  active
                    ? '!border-foreground !bg-foreground !text-background'
                    : '!border-border !text-muted hover:!text-foreground',
                )}
              >
                <Icon aria-hidden size={15} />
                {t.name}
              </Button>
            );
          })}
        </div>

        <p className="text-sm text-subtle">
          Example: {tenant.name}, configured in GOLD.
        </p>

        <div className="max-w-2xl">
          <ShellPreview tenant={tenant} />
        </div>
      </section>

      {/* Autonomy spectrum — interactive stepper, one concrete example per stage */}
      <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            How much runs on its own is up to you.
          </h2>
          <p className="max-w-lg text-muted">Select a stage to see what it looks like.</p>
        </div>

        <div
          className="relative flex items-start justify-between"
          role="tablist"
          aria-label="Autonomy stages"
        >
          <div aria-hidden className="absolute left-0 right-0 top-2.5 h-px bg-border" />
          {STAGES.map((s, i) => {
            const active = i === stageIndex;
            return (
              <Button
                key={s.name}
                type="button"
                tone="secondary"
                role="tab"
                aria-selected={active}
                onClick={() => setStageIndex(i)}
                className="group relative flex flex-col items-center gap-2 rounded bg-surface !border-0 !px-1 !py-0"
              >
                <span
                  className={cx(
                    'h-5 w-5 rounded-full border-2 transition-colors',
                    active
                      ? 'border-foreground bg-foreground'
                      : 'border-border bg-surface group-hover:border-foreground',
                  )}
                />
                <span className={cx('text-xs font-medium', active ? 'text-foreground' : 'text-muted')}>
                  {s.name}
                </span>
              </Button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-6">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{stage.name}</h3>
            <Badge tone={stage.available ? 'neutral' : 'accent'}>
              {stage.available ? 'Available today' : 'Direction'}
            </Badge>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-muted">{stage.body}</p>
          <p className="max-w-xl rounded border border-border bg-background p-3 font-mono text-xs leading-relaxed text-subtle">
            {stage.detail}
          </p>
        </div>
      </section>

      {/* Where it stands today */}
      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Running it from five different places.
        </h2>
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

      {/* Capabilities */}
      <section id="capabilities" className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            What a configured system can cover.
          </h2>
          <p className="max-w-lg text-muted">
            You switch on what your business uses and pay for that — not a bundle of everything,
            and not a stripped-down tier of it either.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <div key={capability.name} className="flex flex-col gap-2 border-t-2 border-foreground pt-4">
              <h3 className="text-base font-semibold">{capability.name}</h3>
              <p className="text-sm leading-relaxed text-muted">{capability.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Implementation */}
      <section className="flex flex-col gap-8">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How implementation works.</h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {IMPLEMENTATION.map((phase) => (
            <div key={phase.step} className="flex flex-col gap-2">
              <p className="font-mono text-sm text-subtle">{phase.step}</p>
              <h3 className="text-base font-semibold">{phase.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{phase.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Vendor strip, deliberately subordinate */}
      <section className="flex flex-col gap-4 border-y border-border py-5 sm:flex-row sm:items-center sm:gap-10">
        <p className="shrink-0 text-xs font-medium text-subtle">Built on</p>
        <div
          className="min-w-0 flex-1 overflow-hidden"
          style={{
            maskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)',
            WebkitMaskImage:
              'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)',
          }}
        >
          <div
            className="flex w-max items-center gap-12 motion-safe:animate-[marquee_22s_linear_infinite]"
          >
            {[...BUILT_ON, ...BUILT_ON].map((name, index) => (
              <span key={`${name}-${index}`} className="text-base font-medium tracking-tight text-subtle">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA — the one bold, inverted moment on the page */}
      <section id="review" className="-mx-4 scroll-mt-6 rounded-lg bg-foreground px-6 py-14 text-background sm:-mx-6 sm:px-12">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            A workflow review is a conversation about how your business runs today.
          </h2>
          <p className="max-w-md opacity-70">
            From there: we configure GOLD around it, you review exactly what&rsquo;s been set up,
            and you launch when it&rsquo;s ready — never before.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ButtonLink href="/workflow-review" tone="primary" className="!bg-background !text-foreground">
              Request a workflow review
            </ButtonLink>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/login" className="font-medium underline underline-offset-4 opacity-80 hover:opacity-100">
              Already have an account? Log in
            </Link>
            <Link href="/sign-up" className="font-medium underline underline-offset-4 opacity-80 hover:opacity-100">
              Want to explore on your own? Start here
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
