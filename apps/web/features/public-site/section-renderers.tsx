import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, ClipboardList, Layers, MessageSquare, Users } from 'lucide-react';
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
        <span className="font-mono text-xs text-subtle">Example setup</span>
      </div>
      <div className="grid @min-[40rem]/site:grid-cols-[150px_1fr]">
        <nav aria-label="Product preview" className="hidden border-r border-border p-3 @min-[40rem]/site:block">
          {[[CalendarDays, 'Today'], [ClipboardList, 'Work'], [Users, 'Customers'], [MessageSquare, 'Calls']].map(([Icon, label], index) => (
            <div key={label as string} className={cx('flex items-center gap-2 rounded px-2.5 py-2 text-xs', index === 0 ? 'bg-foreground font-medium text-background' : 'text-muted')}>
              <Icon aria-hidden size={14} />{label as string}
            </div>
          ))}
        </nav>
        <div className="p-4 @min-[40rem]/site:p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="border-t-2 border-foreground pt-3"><p className="text-xs text-muted">Committed today</p><p className="mt-1 text-2xl font-semibold tabular-nums">6</p></div>
            <div className="border-t-2 border-foreground pt-3"><p className="text-xs text-muted">Waiting to schedule</p><p className="mt-1 text-2xl font-semibold tabular-nums">2</p></div>
          </div>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {rows.map(([time, work, resource]) => (
              <div key={`${time}-${work}`} className="grid grid-cols-[3.5rem_1fr] gap-3 py-3 text-xs @min-[40rem]/site:grid-cols-[3.5rem_1fr_auto]">
                <span className="font-mono text-subtle">{time}</span><span className="font-medium">{work}</span><span className="hidden text-muted @min-[40rem]/site:block">{resource}</span>
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
    <div className={cx('mt-2 flex flex-col gap-4 @min-[40rem]/site:flex-row @min-[40rem]/site:items-center', section.variant === 'centered' && '@min-[40rem]/site:justify-center')}>
      <ButtonLink href={internal(section.primaryCta.href, context)} tone="primary">{section.primaryCta.label}</ButtonLink>
      <Secondary link={section.secondaryCta} context={context} />
    </div>
  );
  const preview = section.variant === 'preview';
  const centered = section.variant === 'centered';
  const text = (
    <div className={cx('flex flex-col gap-6', centered ? 'mx-auto w-full max-w-3xl items-center text-center' : 'items-start')}>
      <Eyebrow>{section.eyebrow}</Eyebrow>
      <h1 className={cx('text-balance font-semibold tracking-tight', preview ? 'max-w-2xl text-4xl leading-[1.04] @min-[40rem]/site:text-6xl' : 'text-4xl leading-[1.06] @min-[40rem]/site:text-5xl')}>{section.heading}</h1>
      <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted">{section.body}</p>
      {actions}
    </div>
  );
  if (!preview) return <section className={centered ? undefined : 'max-w-3xl'}>{text}</section>;
  return (
    <section className="grid gap-12 @min-[64rem]/site:grid-cols-[1fr_460px] @min-[64rem]/site:items-center @min-[64rem]/site:gap-16">
      {text}<ProductPreview />
    </section>
  );
}

function Problem({ section }: RenderProps<'problem'>) {
  return (
    <section className="-mx-2 grid gap-10 rounded-2xl bg-secondary px-6 py-12 @min-[40rem]/site:px-12 @min-[40rem]/site:py-16 @min-[64rem]/site:grid-cols-[0.7fr_1fr] @min-[64rem]/site:gap-20">
      <h2 className="max-w-md text-2xl font-semibold tracking-tight @min-[40rem]/site:text-3xl">{section.heading}</h2>
      <div className="grid gap-5 text-sm leading-relaxed text-muted @min-[40rem]/site:grid-cols-2">{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </section>
  );
}

function Content({ section }: RenderProps<'content'>) {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Eyebrow>{section.eyebrow}</Eyebrow>
      <h2 className="text-2xl font-semibold tracking-tight @min-[40rem]/site:text-3xl">{section.heading}</h2>
      <div className="grid gap-4 leading-relaxed text-muted">{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </section>
  );
}

/**
 * What a business offers. `cards` (the default, and every section saved before layouts existed) is
 * a grid of boxed cards; `list` is an index: the heading beside a ruled list, one row per item, for
 * a section whose items are places to go next rather than things to read. A card links only when
 * its own `href` says where, so nothing here guesses a destination from a title.
 */
function Capabilities({ section, context, anchored }: RenderProps<'capabilities'>) {
  const heading = (
    <div className="flex max-w-2xl flex-col gap-3">
      <Eyebrow>{section.eyebrow}</Eyebrow>
      <h2 className="text-balance text-2xl font-semibold tracking-tight @min-[40rem]/site:text-3xl">{section.heading}</h2>
      <p className="text-pretty text-muted">{section.body}</p>
    </div>
  );

  if (section.variant === 'list') {
    return (
      <section id={anchored ? 'products' : undefined} className="grid scroll-mt-24 gap-8 @min-[56rem]/site:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] @min-[56rem]/site:gap-16">
        <div className="@min-[56rem]/site:sticky @min-[56rem]/site:top-28 @min-[56rem]/site:self-start">{heading}</div>
        <ul className="border-t border-border">
          {section.items.map((item, index) => {
            const row = (
              <>
                <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
                <p className="col-start-1 text-pretty text-sm leading-relaxed text-muted">{item.body}</p>
              </>
            );
            return (
              <li key={index} className="border-b border-border">
                {item.href ? (
                  <Link
                    href={internal(item.href, context)}
                    className={cx('group -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 rounded-md px-3 py-5 transition-colors hover:bg-secondary', FOCUS_RING)}
                  >
                    {row}
                    <ArrowRight aria-hidden size={18} className="col-start-2 row-span-2 row-start-1 text-muted transition-transform group-hover:text-foreground motion-safe:group-hover:translate-x-1" />
                  </Link>
                ) : (
                  <div className="grid gap-y-1 py-5">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <section id={anchored ? 'products' : undefined} className="scroll-mt-24">
      {heading}
      <div className="mt-10 grid gap-5 @min-[40rem]/site:grid-cols-2 @min-[64rem]/site:grid-cols-3">
        {section.items.map((item, index) => {
          const body = (
            <>
              <span className="mb-5 flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
                <Layers aria-hidden size={18} />
              </span>
              <h3 className="flex items-center gap-1.5 text-lg font-semibold">
                {item.title}
                {item.href ? <ArrowRight aria-hidden size={14} className="text-muted transition-transform motion-safe:group-hover:translate-x-0.5" /> : null}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
            </>
          );
          return item.href ? (
            <Link key={index} href={internal(item.href, context)} className={cx('group block rounded-xl border border-border bg-surface p-6 shadow-sm transition hover:border-foreground/40 hover:shadow-md motion-safe:hover:-translate-y-0.5', FOCUS_RING)}>
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
    <section id={anchored ? 'how-it-works' : undefined} className="scroll-mt-24"><div className="grid gap-10 @min-[64rem]/site:grid-cols-[0.7fr_1fr] @min-[64rem]/site:gap-20">
      <div><Eyebrow>{section.eyebrow}</Eyebrow><h2 className="mt-3 text-2xl font-semibold tracking-tight @min-[40rem]/site:text-3xl">{section.heading}</h2></div>
      <ol className="flex flex-col gap-3">{section.items.map((item, index) => <li key={index} className="grid gap-2 rounded-xl border border-border bg-surface p-5 shadow-sm @min-[40rem]/site:grid-cols-[3rem_12rem_1fr] @min-[40rem]/site:gap-4"><span className="font-mono text-xs text-subtle">{item.step}</span><h3 className="text-sm font-semibold">{item.title}</h3><p className="text-sm leading-relaxed text-muted">{item.body}</p></li>)}</ol>
    </div></section>
  );
}

function Trust({ section }: RenderProps<'trust'>) {
  return (
    <section className="grid gap-8 rounded-xl border border-border bg-surface p-6 @min-[40rem]/site:p-10 @min-[64rem]/site:grid-cols-3">
      <div><Eyebrow>{section.eyebrow}</Eyebrow><h2 className="mt-3 text-2xl font-semibold tracking-tight">{section.heading}</h2></div>
      <div className="grid gap-8 text-sm leading-relaxed text-muted @min-[40rem]/site:grid-cols-2 @min-[64rem]/site:col-span-2">{section.items.map((item, index) => <div key={index}><h3 className="font-semibold text-foreground">{item.title}</h3><p className="mt-2">{item.body}</p></div>)}</div>
    </section>
  );
}

function Cta({ section, context }: RenderProps<'cta'>) {
  return (
    <section className="-mx-4 rounded-xl bg-foreground px-6 py-14 text-background @min-[40rem]/site:-mx-6 @min-[40rem]/site:px-12"><div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5">
      <h2 className="text-2xl font-semibold tracking-tight @min-[40rem]/site:text-4xl">{section.heading}</h2><p className="max-w-xl opacity-75">{section.body}</p>
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
  return <div data-section={section.kind} className="@container/site min-w-0">{Render({ section: section as never, context, anchored })}</div>;
}

/** The sections of a page, in order. A page never holds two elements with one anchor id. */
export function PageSections({ sections, context = NO_FORMS }: { sections: WebsiteSection[]; context?: FormSectionContext }) {
  const seen = new Set<SectionKind>();
  return (
    <div className="@container/site flex min-w-0 flex-col gap-24 py-6 @min-[40rem]/site:gap-32 @min-[40rem]/site:py-10">
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
