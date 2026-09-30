import Link from 'next/link';
import { ArrowRight, CalendarDays, ClipboardList, Headset, Layers, MessageSquare, TrendingUp, Users, Workflow, type LucideIcon } from 'lucide-react';
import type { PublicHomepageSection, PublicHomepageSections } from '@gold/schemas';
import { ButtonLink } from '@/components/controls/button';
import { FOCUS_RING, cx } from '@/components/class-names';

/**
 * The three commercial doors, in the order the `capabilities` section's items are seeded
 * (`app.default_gold_homepage_sections()`). A title this map does not recognise renders as plain
 * text rather than a link — an editor changing the wording in the public-site editor degrades to
 * an unlinked card instead of a broken route.
 */
const PRODUCT_HREF_BY_TITLE: Record<string, string> = {
  Sales: '/sales',
  Operations: '/operations',
  'Customer Service': '/customer-service',
};

const PRODUCT_ICON_BY_TITLE: Record<string, LucideIcon> = {
  Sales: TrendingUp,
  Operations: Workflow,
  'Customer Service': Headset,
};

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
          {[[CalendarDays, 'Today'], [ClipboardList, 'Work'], [Users, 'Customers'], [MessageSquare, 'Calls']].map(([Icon, label], index) => (
            <div key={label as string} className={cx('flex items-center gap-2 rounded px-2.5 py-2 text-xs', index === 0 ? 'bg-foreground font-medium text-background' : 'text-muted')}>
              <Icon aria-hidden size={14} />{label as string}
            </div>
          ))}
        </nav>
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="border-t-2 border-foreground pt-3"><p className="text-xs text-muted">Committed today</p><p className="mt-1 text-2xl font-semibold tabular-nums">6</p></div>
            <div className="border-t-2 border-foreground pt-3"><p className="text-xs text-muted">Waiting to schedule</p><p className="mt-1 text-2xl font-semibold tabular-nums">2</p></div>
          </div>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {rows.map(([time, work, resource]) => (
              <div key={`${time}-${work}`} className="grid grid-cols-[3.5rem_1fr] gap-3 py-3 text-xs sm:grid-cols-[3.5rem_1fr_auto]">
                <span className="font-mono text-subtle">{time}</span><span className="font-medium">{work}</span><span className="hidden text-muted sm:block">{resource}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One section, rendered exactly as the public site would. The public renderer and Studio's Canvas
 * both call this — the only rendering vocabulary either owns, so Canvas can never drift from what
 * a visitor actually sees (never a second, editor-only approximation of the same six sections).
 */
export function HomepageSectionRenderer({ section }: { section: PublicHomepageSection }) {
  return <>{renderSection(section)}</>;
}

function renderSection(section: PublicHomepageSection) {
  switch (section.kind) {
    case 'hero': return (
      <section key={section.kind} className="grid gap-12 lg:grid-cols-[1fr_460px] lg:items-center lg:gap-16">
        <div className="flex flex-col items-start gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">{section.eyebrow}</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">{section.heading}</h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">{section.body}</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
            <ButtonLink href={section.primaryCta.href} tone="primary">{section.primaryCta.label}</ButtonLink>
            <a href={section.secondaryCta.href} className={cx('rounded text-sm font-medium text-muted hover:text-foreground', FOCUS_RING)}>{section.secondaryCta.label}</a>
          </div>
        </div><ProductPreview />
      </section>
    );
    case 'problem': return (
      <section key={section.kind} className="-mx-2 grid gap-10 rounded-2xl bg-secondary px-6 py-12 sm:px-12 sm:py-16 lg:grid-cols-[0.7fr_1fr] lg:gap-20">
        <h2 className="max-w-md text-2xl font-semibold tracking-tight sm:text-3xl">{section.heading}</h2>
        <div className="grid gap-5 text-sm leading-relaxed text-muted sm:grid-cols-2">{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      </section>
    );
    case 'capabilities': return (
      <section key={section.kind} id="products" className="scroll-mt-24">
        <div className="flex max-w-2xl flex-col gap-3"><p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">{section.eyebrow}</p><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{section.heading}</h2><p className="text-muted">{section.body}</p></div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {section.items.map((item) => {
            const href = PRODUCT_HREF_BY_TITLE[item.title];
            const Icon = PRODUCT_ICON_BY_TITLE[item.title] ?? Layers;
            const body = (
              <>
                <span className="mb-5 flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
                  <Icon aria-hidden size={18} />
                </span>
                <h3 className="flex items-center gap-1.5 text-lg font-semibold">
                  {item.title}
                  {href ? <ArrowRight aria-hidden size={14} className="text-muted transition-transform group-hover:translate-x-0.5" /> : null}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </>
            );
            return href ? (
              <Link key={item.title} href={href} className={cx('group block rounded-xl border border-border bg-surface p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md', FOCUS_RING)}>
                {body}
              </Link>
            ) : (
              <article key={item.title} className="rounded-xl border border-border bg-surface p-6 shadow-sm">{body}</article>
            );
          })}
        </div>
      </section>
    );
    case 'process': return (
      <section key={section.kind} id="how-it-works" className="scroll-mt-24"><div className="grid gap-10 lg:grid-cols-[0.7fr_1fr] lg:gap-20">
        <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">{section.eyebrow}</p><h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{section.heading}</h2></div>
        <ol className="flex flex-col gap-3">{section.items.map((item) => <li key={item.step} className="grid gap-2 rounded-xl border border-border bg-surface p-5 shadow-sm sm:grid-cols-[3rem_12rem_1fr] sm:gap-4"><span className="font-mono text-xs text-subtle">{item.step}</span><h3 className="text-sm font-semibold">{item.title}</h3><p className="text-sm leading-relaxed text-muted">{item.body}</p></li>)}</ol>
      </div></section>
    );
    case 'trust': return (
      <section key={section.kind} className="grid gap-8 rounded-xl border border-border bg-surface p-6 sm:p-10 lg:grid-cols-3">
        <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">{section.eyebrow}</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">{section.heading}</h2></div>
        <div className="grid gap-8 text-sm leading-relaxed text-muted sm:grid-cols-2 lg:col-span-2">{section.items.map((item) => <div key={item.title}><h3 className="font-semibold text-foreground">{item.title}</h3><p className="mt-2">{item.body}</p></div>)}</div>
      </section>
    );
    case 'cta': return (
      <section key={section.kind} className="-mx-4 rounded-xl bg-foreground px-6 py-14 text-background sm:-mx-6 sm:px-12"><div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">{section.heading}</h2><p className="max-w-xl opacity-75">{section.body}</p>
        <ButtonLink href={section.primaryCta.href} className="!inline-flex items-center gap-2 !bg-background !text-foreground">{section.primaryCta.label} <ArrowRight aria-hidden size={16} /></ButtonLink>
        <p className="text-sm opacity-75"><Link href={section.secondaryCta.href} className="font-medium underline underline-offset-4">{section.secondaryCta.label}</Link></p>
      </div></section>
    );
    default: return section satisfies never;
  }
}

/** The only renderer for both published output and authenticated previews. */
export function HomepageRenderer({ sections }: { sections: PublicHomepageSections }) {
  return <div className="flex flex-col gap-24 py-6 sm:gap-32 sm:py-10">{sections.map(renderSection)}</div>;
}
