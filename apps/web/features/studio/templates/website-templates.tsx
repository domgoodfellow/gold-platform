'use client';

import { useActionState, useMemo, type ReactNode } from 'react';
import {
  WebsiteSectionSchema,
  type NavigationItem, type PageTemplate, type SectionPattern, type SiteTemplate, type WebsitePage, type WebsiteSection,
} from '@gold/schemas';
import { Button, ButtonLink } from '@/components/controls/button';
import { PreviewSurface, type PreviewPage } from '@/components/display/preview-surface';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { DividedList, GroupHeading } from '@/components/surfaces/section';
import { ExperienceView, type ExperienceSite } from '@/features/public-site/experience-view';
import { newId } from '@/lib/domain/public-site/composition';
import { sectionLabel } from '@/lib/domain/public-site/section-registry';
import { createWebsiteAction, type WebsiteActionState } from '@/app/organizations/[organizationId]/studio/website/actions';

const INITIAL: WebsiteActionState = { error: null };

/** The business's public frame a template is previewed in: what it would look like as this business's own site. */
export type TemplateFrame = Pick<ExperienceSite, 'profile' | 'brand'> & { logoSrc: string | null };

/** Sections of a starter, given throwaway ids so the one production renderer can draw them. */
function drawable(sections: Record<string, unknown>[]): WebsiteSection[] {
  return sections.flatMap((section) => {
    const parsed = WebsiteSectionSchema.safeParse({ ...section, id: newId() });
    return parsed.success ? [parsed.data] : [];
  });
}

type DraftPage = Omit<WebsitePage, 'sections'> & { sections: Record<string, unknown>[] };

/** A starter as a drawable site: pages and navigation with throwaway ids, navigation by page id. */
function drawableSite(pages: DraftPage[], navigation: SiteTemplate['navigation'] = []): { pages: WebsitePage[]; navigation: NavigationItem[] } {
  const drawn = pages.map((page) => ({ ...page, sections: drawable(page.sections) }));
  const bySlug = new Map(drawn.map((page) => [page.slug, page.id]));
  return {
    pages: drawn,
    navigation: navigation.flatMap((item) => {
      const pageId = bySlug.get(item.target.slug);
      return pageId ? [{ id: newId(), label: item.label, target: { type: 'page' as const, pageId } }] : [];
    }),
  };
}

const CANVAS = { mode: 'canvas', forms: {} } as const;

/** One previewable page per page of the starter, each drawn in the business's frame. */
function previewPages(site: { pages: WebsitePage[]; navigation: NavigationItem[] }, frame: TemplateFrame): PreviewPage[] {
  return site.pages.map((page) => ({
    key: page.id,
    label: page.name,
    content: (
      <ExperienceView
        experience="organization_website"
        site={{ ...site, profile: frame.profile, brand: frame.brand }}
        page={page}
        logoSrc={frame.logoSrc}
        context={CANVAS}
      />
    ),
  }));
}

function TemplatePreview({ title, site, frame, actions }: { title: string; site: { pages: WebsitePage[]; navigation: NavigationItem[] }; frame: TemplateFrame; actions?: ReactNode }) {
  return (
    <PreviewSurface
      title={title}
      trigger={<Button tone="secondary" size="small" aria-label={`Preview ${title}`}>Preview</Button>}
      pages={previewPages(site, frame)}
      actions={actions}
    />
  );
}

function ByCategory<T extends { key: string; category: string }>({ items, children }: { items: T[]; children: (item: T) => ReactNode }) {
  const categories = [...new Set(items.map((item) => item.category))];
  return (
    <>
      {categories.map((category) => (
        <section key={category} aria-label={category}>
          <GroupHeading>{category}</GroupHeading>
          <DividedList className="mt-2 text-sm">
            {items.filter((item) => item.category === category).map((item) => <li key={item.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">{children(item)}</li>)}
          </DividedList>
        </section>
      ))}
    </>
  );
}

function UseSiteTemplate({ organizationId, template, hasWebsite, action, pending }: { organizationId: string; template: SiteTemplate; hasWebsite: boolean; action: (formData: FormData) => void; pending: boolean }) {
  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="templateKey" value={template.key} />
      <Button size="small" tone="secondary" disabled={pending || hasWebsite} aria-label={`Use ${template.name}`}>Use template</Button>
    </form>
  );
}

function SiteTemplateRow({ organizationId, template, hasWebsite, frame, action, pending }: { organizationId: string; template: SiteTemplate; hasWebsite: boolean; frame: TemplateFrame; action: (formData: FormData) => void; pending: boolean }) {
  const site = useMemo(() => drawableSite(template.pages.map((page) => ({ ...page, id: newId() })), template.navigation), [template]);
  const use = <UseSiteTemplate organizationId={organizationId} template={template} hasWebsite={hasWebsite} action={action} pending={pending} />;
  return (
    <>
      <div className="min-w-0">
        <p className="font-medium">{template.name}</p>
        <p className="text-muted">{template.description}</p>
        <p className="text-xs text-subtle">Website · {template.pages.length} pages · {template.pages.map((page) => page.name).join(', ')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TemplatePreview title={template.name} site={site} frame={frame} actions={use} />
        {use}
      </div>
    </>
  );
}

/**
 * Starter websites. Using one makes the business its own website with its own copy of every page and
 * section — nothing a later edit to the starter does reaches it — and is only possible while the
 * business has none. Previewing one creates nothing.
 */
export function SiteTemplateList({ organizationId, templates, hasWebsite, frame }: { organizationId: string; templates: SiteTemplate[]; hasWebsite: boolean; frame: TemplateFrame }) {
  const [state, action, pending] = useActionState(createWebsiteAction, INITIAL);
  const websiteHref = `/organizations/${organizationId}/studio/website`;
  return (
    <div className="grid gap-4">
      <ErrorText>{state.error}</ErrorText>
      {state.success ? <Hint role="status">{state.success} <ButtonLink tone="text" size="small" href={websiteHref}>Open the website</ButtonLink></Hint> : null}
      {hasWebsite ? <Hint>This business already has a website. Add pages from a page template in the Website editor.</Hint> : null}
      <ByCategory items={templates}>
        {(template) => <SiteTemplateRow organizationId={organizationId} template={template} hasWebsite={hasWebsite} frame={frame} action={action} pending={pending} />}
      </ByCategory>
    </div>
  );
}

function PageTemplateRow({ template, frame }: { template: PageTemplate; frame: TemplateFrame }) {
  const site = useMemo(() => drawableSite([{ ...template.page, id: newId(), isHome: true }]), [template]);
  return (
    <>
      <div className="min-w-0">
        <p className="font-medium">{template.name}</p>
        <p className="text-muted">{template.description}</p>
        <p className="text-xs text-subtle">Page · {template.page.sections.length} sections</p>
      </div>
      <TemplatePreview title={template.name} site={site} frame={frame} />
    </>
  );
}

/** Starter pages, added to a website from inside the Website editor, where the website being edited is. */
export function PageTemplateList({ organizationId, templates, frame }: { organizationId: string; templates: PageTemplate[]; frame: TemplateFrame }) {
  return (
    <div className="grid gap-4">
      <Hint>Page templates are added from the Website editor, with Add page. <ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/studio/website`}>Open the website</ButtonLink></Hint>
      <ByCategory items={templates}>
        {(template) => <PageTemplateRow template={template} frame={frame} />}
      </ByCategory>
    </div>
  );
}

function SectionPatternRow({ pattern, frame }: { pattern: SectionPattern; frame: TemplateFrame }) {
  const site = useMemo(() => drawableSite([{ id: newId(), name: pattern.name, slug: '', isHome: true, seoTitle: pattern.name, seoDescription: pattern.name, sections: [pattern.section] }]), [pattern]);
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <p className="font-medium">{pattern.name}</p>
        <p className="text-muted">{pattern.description}</p>
        <p className="text-xs text-subtle">Section · {sectionLabel(pattern.kind)}</p>
      </div>
      {site.pages[0]?.sections.length ? <TemplatePreview title={pattern.name} site={site} frame={frame} /> : null}
    </li>
  );
}

/** Starter sections: each becomes a real section of a registered kind when it is added, and nothing points back at it. */
export function SectionPatternList({ organizationId, patterns, frame }: { organizationId: string; patterns: SectionPattern[]; frame: TemplateFrame }) {
  return (
    <div className="grid gap-4">
      <Hint>Section patterns are added from the Website editor, with Add section. <ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/studio/website`}>Open the website</ButtonLink></Hint>
      <DividedList className="text-sm">
        {patterns.map((pattern) => <SectionPatternRow key={pattern.key} pattern={pattern} frame={frame} />)}
      </DividedList>
    </div>
  );
}
