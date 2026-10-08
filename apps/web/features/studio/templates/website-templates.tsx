'use client';

import { useActionState, useState } from 'react';
import {
  WebsiteSectionSchema,
  type PageTemplate, type SectionPattern, type SiteTemplate, type WebsiteSection,
} from '@gold/schemas';
import { Button, ButtonLink } from '@/components/controls/button';
import { PreviewFrame } from '@/components/display/preview-frame';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { DividedList, GroupHeading } from '@/components/surfaces/section';
import {
  PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { PageSections, SectionView } from '@/features/public-site/section-renderers';
import { newId } from '@/lib/domain/public-site/composition';
import { sectionLabel } from '@/lib/domain/public-site/section-registry';
import { createWebsiteAction, type WebsiteActionState } from '@/app/organizations/[organizationId]/studio/website/actions';

const INITIAL: WebsiteActionState = { error: null };

/** Sections of a starter, given throwaway ids so the one production renderer can draw them. */
function drawable(sections: Record<string, unknown>[]): WebsiteSection[] {
  return sections.flatMap((section) => {
    const parsed = WebsiteSectionSchema.safeParse({ ...section, id: newId() });
    return parsed.success ? [parsed.data] : [];
  });
}

const CANVAS = { mode: 'canvas', forms: {} } as const;

function Preview({ title, label, children }: { title: string; label: string; children: React.ReactNode }) {
  const [width, setWidth] = useState(390);
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button tone="secondary" size="small" aria-label={`Preview ${title}`}>{label}</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>{title}</PageDrawerTitle></PageDrawerHeader>
        <div role="group" aria-label="Preview viewport" className="flex flex-wrap gap-2">
          {[[390, 'Mobile'], [768, 'Tablet'], [1120, 'Desktop']].map(([value, label]) => <Button key={value} tone={width === value ? 'primary' : 'secondary'} size="small" aria-pressed={width === value} onClick={() => setWidth(Number(value))}>{label}</Button>)}
        </div>
        <PreviewFrame title={`${title} template preview`} width={width}><div className="grid gap-8">{children}</div></PreviewFrame>
      </PageDrawerContent>
    </PageDrawer>
  );
}

function ByCategory<T extends { key: string; category: string }>({ items, children }: { items: T[]; children: (item: T) => React.ReactNode }) {
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

/**
 * Starter websites. Using one makes the business its own website with its own copy of every page and
 * section — nothing a later edit to the starter does reaches it — and is only possible while the
 * business has none.
 */
export function SiteTemplateList({ organizationId, templates, hasWebsite }: { organizationId: string; templates: SiteTemplate[]; hasWebsite: boolean }) {
  const [state, action, pending] = useActionState(createWebsiteAction, INITIAL);
  const websiteHref = `/organizations/${organizationId}/studio/website`;
  return (
    <div className="grid gap-4">
      <ErrorText>{state.error}</ErrorText>
      {state.success ? <Hint role="status">{state.success} <ButtonLink tone="text" size="small" href={websiteHref}>Open the website</ButtonLink></Hint> : null}
      {hasWebsite ? <Hint>This business already has a website. Add pages from a page template in the Website editor.</Hint> : null}
      <ByCategory items={templates}>
        {(template) => (
          <>
            <div className="min-w-0">
              <p className="font-medium">{template.name}</p>
              <p className="text-muted">{template.description}</p>
              <p className="text-xs text-subtle">Website · {template.pages.length} pages · {template.pages.map((page) => page.name).join(', ')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Preview title={template.name} label="Preview">
                {template.pages.map((page) => (
                  <section key={page.name} aria-label={page.name} className="grid gap-2">
                    <GroupHeading>{page.name}</GroupHeading>
                    <div className="rounded-lg border border-border bg-background p-3"><PageSections sections={drawable(page.sections)} context={CANVAS} /></div>
                  </section>
                ))}
              </Preview>
              <form action={action}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="templateKey" value={template.key} />
                <Button size="small" tone="secondary" disabled={pending || hasWebsite} aria-label={`Use ${template.name}`}>Use template</Button>
              </form>
            </div>
          </>
        )}
      </ByCategory>
    </div>
  );
}

/** Starter pages, added to a website from inside the Website editor, where the website being edited is. */
export function PageTemplateList({ organizationId, templates }: { organizationId: string; templates: PageTemplate[] }) {
  return (
    <div className="grid gap-4">
      <Hint>Page templates are added from the Website editor, with Add page. <ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/studio/website`}>Open the website</ButtonLink></Hint>
      <ByCategory items={templates}>
        {(template) => (
          <>
            <div className="min-w-0">
              <p className="font-medium">{template.name}</p>
              <p className="text-muted">{template.description}</p>
              <p className="text-xs text-subtle">Page · {template.page.sections.length} sections</p>
            </div>
            <Preview title={template.name} label="Preview">
              <div className="rounded-lg border border-border bg-background p-3"><PageSections sections={drawable(template.page.sections)} context={CANVAS} /></div>
            </Preview>
          </>
        )}
      </ByCategory>
    </div>
  );
}

/** Starter sections: each becomes a real section of a registered kind when it is added, and nothing points back at it. */
export function SectionPatternList({ organizationId, patterns }: { organizationId: string; patterns: SectionPattern[] }) {
  return (
    <div className="grid gap-4">
      <Hint>Section patterns are added from the Website editor, with Add section. <ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/studio/website`}>Open the website</ButtonLink></Hint>
      <DividedList className="text-sm">
        {patterns.map((pattern) => {
          const [section] = drawable([pattern.section]);
          return (
            <li key={pattern.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="min-w-0">
                <p className="font-medium">{pattern.name}</p>
                <p className="text-muted">{pattern.description}</p>
                <p className="text-xs text-subtle">Section · {sectionLabel(pattern.kind)}</p>
              </div>
              {section ? (
                <Preview title={pattern.name} label="Preview">
                  <div className="rounded-lg border border-border bg-background p-3"><SectionView section={section} context={CANVAS} anchored={false} /></div>
                </Preview>
              ) : null}
            </li>
          );
        })}
      </DividedList>
    </div>
  );
}
