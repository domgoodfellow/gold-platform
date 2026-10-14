'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import type { PageTemplate, SectionPattern, SiteTemplate } from '@gold/schemas';
import { cx, FOCUS_RING } from '@/components/class-names';
import { TemplateList } from '@/features/studio/forms/template-list';
import type { FormTemplate } from '@/lib/domain/forms/forms';
import { PageTemplateList, SectionPatternList, SiteTemplateList } from './website-templates';
import { PORTAL_TEMPLATES } from '@/lib/domain/portal/composition';
import { ButtonLink } from '@/components/controls/button';
import { PortalTemplatePreview } from '@/features/studio/portal/portal-template-preview';

type Filter = 'all' | 'website' | 'pages' | 'sections' | 'forms' | 'portal';
type TemplateMetadata = { name: string; description: string; category?: string; kind?: string };
const categoryOf = (item: TemplateMetadata) => item.category ?? item.kind ?? 'general';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'website', label: 'Website' }, { key: 'pages', label: 'Pages' },
  { key: 'sections', label: 'Sections' }, { key: 'forms', label: 'Forms' }, { key: 'portal', label: 'Portal' },
];

/**
 * Studio's starting points, by what they make: a website, a page, a section, a form. Each kind keeps
 * its own typed templates — one catalogue to browse, never one table of untyped payloads — and the
 * filter says which kind of thing each row would create.
 */
export function TemplatesBrowser({ organizationId, hasWebsite, hasPortal = false, siteTemplates, pageTemplates, sectionPatterns, formTemplates }: {
  organizationId: string;
  hasWebsite: boolean;
  hasPortal?: boolean;
  siteTemplates: SiteTemplate[];
  pageTemplates: PageTemplate[];
  sectionPatterns: SectionPattern[];
  formTemplates: FormTemplate[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const kind = params.get('kind');
  const filter: Filter = FILTERS.find((entry) => entry.key === kind)?.key ?? 'all';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('recommended');
  const categories = [...new Set([...siteTemplates, ...pageTemplates, ...sectionPatterns, ...formTemplates, ...PORTAL_TEMPLATES].map(categoryOf))].sort();
  const matches = (item: TemplateMetadata) => (category === 'all' || categoryOf(item) === category) && `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase());
  const visible = <T extends TemplateMetadata,>(items: T[]) => {
    const result = items.filter(matches);
    return sort === 'name' ? result.sort((a, b) => a.name.localeCompare(b.name)) : result;
  };
  const show = (kind: Exclude<Filter, 'all'>) => filter === 'all' || filter === kind;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-surface p-3">
        <TextInput type="search" aria-label="Search templates" placeholder="Search templates…" value={search} onChange={(event) => setSearch(event.target.value)} className="sm:max-w-sm" />
        <SelectInput aria-label="Template category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</SelectInput>
        <SelectInput aria-label="Sort templates" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recommended">Catalog order</option><option value="name">Name</option></SelectInput>
      </div>
      <div role="group" aria-label="Kind of template" className="flex flex-wrap gap-1">
        {FILTERS.map((entry) => (
          <button
            key={entry.key} type="button" aria-pressed={filter === entry.key} onClick={() => router.replace(`?kind=${entry.key}`, { scroll: false })}
            className={cx('rounded-md border border-border px-3 py-1 text-sm transition', FOCUS_RING, filter === entry.key ? 'bg-foreground text-background' : 'text-muted hover:text-foreground')}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {show('website') ? <section aria-label="Website templates" className="grid min-w-0 gap-3 rounded-lg border border-border bg-surface p-4"><h2 className="text-base font-semibold">Website</h2><SiteTemplateList organizationId={organizationId} templates={visible(siteTemplates)} hasWebsite={hasWebsite} /></section> : null}
      {show('portal') ? <section aria-label="Portal templates" className="grid min-w-0 gap-3 rounded-lg border border-border bg-surface p-4"><h2 className="text-base font-semibold">Portal</h2>{visible([...PORTAL_TEMPLATES]).map(item => <article key={item.key} className="rounded-md border border-border p-3"><h3 className="font-medium">{item.name}</h3><p className="mt-2 text-sm text-muted">{item.description}</p>{hasPortal ? <p className="mt-2 text-sm text-muted">Your organization already owns a Portal. <ButtonLink href={`/organizations/${organizationId}/studio/portal`} tone="text">Open Portal draft</ButtonLink></p> : <ButtonLink href={`/organizations/${organizationId}/studio/portal?template=${item.key}`} tone="secondary">Start with {item.name}</ButtonLink>}<details className="mt-3"><summary>Preview template</summary><PortalTemplatePreview content={item.definition}/></details></article>)}</section> : null}
      {show('pages') ? <section aria-label="Page templates" className="grid min-w-0 gap-3 rounded-lg border border-border bg-surface p-4"><h2 className="text-base font-semibold">Pages</h2><PageTemplateList organizationId={organizationId} templates={visible(pageTemplates)} /></section> : null}
      {show('sections') ? <section aria-label="Section patterns" className="grid min-w-0 gap-3 rounded-lg border border-border bg-surface p-4"><h2 className="text-base font-semibold">Sections</h2><SectionPatternList organizationId={organizationId} patterns={visible(sectionPatterns)} /></section> : null}
      {show('forms') ? <section aria-label="Form templates" className="grid min-w-0 gap-3 rounded-lg border border-border bg-surface p-4"><h2 className="text-base font-semibold">Forms</h2><TemplateList organizationId={organizationId} templates={visible(formTemplates)} /></section> : null}
      {![...(show('website') ? siteTemplates : []), ...(show('pages') ? pageTemplates : []), ...(show('sections') ? sectionPatterns : []), ...(show('forms') ? formTemplates : []), ...(show('portal') ? PORTAL_TEMPLATES : [])].some(matches) ? <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">No templates match these filters.</p> : null}
    </div>
  );
}
