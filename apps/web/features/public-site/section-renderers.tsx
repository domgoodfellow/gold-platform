import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, ClipboardList, Headset, Layers, MessageSquare, TrendingUp, Users, Workflow, type LucideIcon } from 'lucide-react';
import type { PublicLink, SectionKind, SectionOf, WebsiteSection } from '@gold/schemas';
import { ButtonLink } from '@/components/controls/button';
import { FOCUS_RING, cx } from '@/components/class-names';
import { FormSection, type FormSectionContext } from './form-section';

/**
 * How every kind of section is drawn. The public site, Studio's canvas and the private preview all
 * go through `SectionView`, so what a business edits is what a visitor sees — editor chrome wraps
 * this and never replaces it. `SECTION_RENDERERS` is keyed by every registered kind, so a kind with
 * no renderer is a type error rather than a blank space.
 */

/** Where a link inside the website points, given the context it is drawn in. */
function internal(href: string, context: FormSectionContext): string {
  return context.linkBase !== undefined && href.startsWith('/') ? `${context.linkBase}${href}` : href;
}

function Eyebrow({ children }: { children: string }) {
  return children ? <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">{children}</p> : null;
}

function Secondary({ link, context }: { link: PublicLink | undefined; context: FormSectionContext }) {
  if (!link) return null;
  return <a href={internal(link.href, context)} className={cx('rounded text-sm font-medium text-muted hover:text-foreground', FOCUS_RING)}>{link.label}</a>;
}

/**
 * The three commercial doors, in the order the `capabilities` section's items are seeded for
 * GildOps' own homepage. A title this map does not recognise renders as plain text rather than a
 * link — a business whose cards happen to share a title degrades to an unlinked card.
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

type RenderProps<K extends SectionKind> = { section: SectionOf<K>; context: FormSectionContext; anchored: boolean };

function Hero({ section, context }: RenderProps<'hero'>) {
  const actions = (
    <div className={cx('mt-2 flex flex-col gap-4 sm:flex-row sm:items-center', section.variant === 'centered' && 'sm:justify-center')}>
      <ButtonLink href={internal(section.primaryCta.href, context)} tone="primary">{section.primaryCta.label}</ButtonLink>
      <Secondary link={section.secondaryCta} context={context} />
    </div>
  );
  const preview = section.variant === 'preview';
  const centered = section.variant === 'centered';
  const text = (
    <div className={cx('flex flex-col gap-6', centered ? 'mx-auto w-full max-w-3xl items-center text-center' : 'items-start')}>
      <Eyebrow>{section.eyebrow}</Eyebrow>
      <h1 className={cx('font-semibold tracking-tight', preview ? 'max-w-2xl text-4xl leading-[1.04] sm:text-6xl' : 'text-4xl leading-[1.06] sm:text-5xl')}>{section.heading}</h1>
      <p className="max-w-xl text-lg leading-relaxed text-muted">{section.body}</p>
      {actions}
    </div>
  );
  if (!preview) return <section className={centered ? undefined : 'max-w-3xl'}>{text}</section>;
  return (
    <section className="grid gap-12 lg:grid-cols-[1fr_460px] lg:items-center lg:gap-16">
      {text}<ProductPreview />
    </section>
  );
}

function Problem({ section }: RenderProps<'problem'>) {
  return (
    <section className="-mx-2 grid gap-10 rounded-2xl bg-secondary px-6 py-12 sm:px-12 sm:py-16 lg:grid-cols-[0.7fr_1fr] lg:gap-20">
      <h2 className="max-w-md text-2xl font-semibold tracking-tight sm:text-3xl">{section.heading}</h2>
      <div className="grid gap-5 text-sm leading-relaxed text-muted sm:grid-cols-2">{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </section>
  );
}

function Content({ section }: RenderProps<'content'>) {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Eyebrow>{section.eyebrow}</Eyebrow>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{section.heading}</h2>
      <div className="grid gap-4 leading-relaxed text-muted">{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </section>
  );
}

function Capabilities({ section, anchored }: RenderProps<'capabilities'>) {
  return (
    <section id={anchored ? 'products' : undefined} className="scroll-mt-24">
      <div className="flex max-w-2xl flex-col gap-3"><Eyebrow>{section.eyebrow}</Eyebrow><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{section.heading}</h2><p className="text-muted">{section.body}</p></div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {section.items.map((item, index) => {
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
            <Link key={index} href={href} className={cx('group block rounded-xl border border-border bg-surface p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md', FOCUS_RING)}>
              {body}
            </Link>
          ) : (
            <article key={index} className="rounded-xl border border-border bg-surface p-6 shadow-sm">{body}</article>
          );
        })}
      </div>
    </section>
  );
}

function Process({ section, anchored }: RenderProps<'process'>) {
  return (
    <section id={anchored ? 'how-it-works' : undefined} className="scroll-mt-24"><div className="grid gap-10 lg:grid-cols-[0.7fr_1fr] lg:gap-20">
      <div><Eyebrow>{section.eyebrow}</Eyebrow><h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{section.heading}</h2></div>
      <ol className="flex flex-col gap-3">{section.items.map((item, index) => <li key={index} className="grid gap-2 rounded-xl border border-border bg-surface p-5 shadow-sm sm:grid-cols-[3rem_12rem_1fr] sm:gap-4"><span className="font-mono text-xs text-subtle">{item.step}</span><h3 className="text-sm font-semibold">{item.title}</h3><p className="text-sm leading-relaxed text-muted">{item.body}</p></li>)}</ol>
    </div></section>
  );
}

function Trust({ section }: RenderProps<'trust'>) {
  return (
    <section className="grid gap-8 rounded-xl border border-border bg-surface p-6 sm:p-10 lg:grid-cols-3">
      <div><Eyebrow>{section.eyebrow}</Eyebrow><h2 className="mt-3 text-2xl font-semibold tracking-tight">{section.heading}</h2></div>
      <div className="grid gap-8 text-sm leading-relaxed text-muted sm:grid-cols-2 lg:col-span-2">{section.items.map((item, index) => <div key={index}><h3 className="font-semibold text-foreground">{item.title}</h3><p className="mt-2">{item.body}</p></div>)}</div>
    </section>
  );
}

function Cta({ section, context }: RenderProps<'cta'>) {
  return (
    <section className="-mx-4 rounded-xl bg-foreground px-6 py-14 text-background sm:-mx-6 sm:px-12"><div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">{section.heading}</h2><p className="max-w-xl opacity-75">{section.body}</p>
      <ButtonLink href={internal(section.primaryCta.href, context)} className="!inline-flex items-center gap-2 !bg-background !text-foreground">{section.primaryCta.label} <ArrowRight aria-hidden size={16} /></ButtonLink>
      {section.secondaryCta ? <p className="text-sm opacity-75"><Link href={internal(section.secondaryCta.href, context)} className="font-medium underline underline-offset-4">{section.secondaryCta.label}</Link></p> : null}
    </div></section>
  );
}

function Form({ section, context, anchored }: RenderProps<'form'>) {
  return <FormSection heading={section.heading} body={section.body} formId={section.formId} context={context} anchorId={anchored ? 'contact' : undefined} />;
}

export const SECTION_RENDERERS: { [K in SectionKind]: (props: RenderProps<K>) => ReactNode } = {
  hero: Hero, problem: Problem, content: Content, capabilities: Capabilities, process: Process, trust: Trust, cta: Cta, form: Form,
};

/** One section, rendered exactly as the public website would. */
export function SectionView({ section, context, anchored = true }: { section: WebsiteSection; context: FormSectionContext; anchored?: boolean }) {
  const Render = SECTION_RENDERERS[section.kind] as (props: RenderProps<SectionKind>) => ReactNode;
  return <>{Render({ section: section as never, context, anchored })}</>;
}

/** The sections of a page, in order. A page never holds two elements with one anchor id. */
export function PageSections({ sections, context = NO_FORMS }: { sections: WebsiteSection[]; context?: FormSectionContext }) {
  const seen = new Set<SectionKind>();
  return (
    <div className="flex flex-col gap-24 py-6 sm:gap-32 sm:py-10">
      {sections.map((section) => {
        const anchored = !seen.has(section.kind);
        seen.add(section.kind);
        return <SectionView key={section.id} section={section} context={context} anchored={anchored} />;
      })}
    </div>
  );
}

/** A page with no `form` section needs no forms; this is what it passes. */
export const NO_FORMS: FormSectionContext = { mode: 'live', forms: {} };
