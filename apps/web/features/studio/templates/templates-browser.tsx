'use client';

import { useState } from 'react';
import type { PageTemplate, SectionPattern, SiteTemplate } from '@gold/schemas';
import { cx, FOCUS_RING } from '@/components/class-names';
import { TemplateList } from '@/features/studio/forms/template-list';
import type { FormTemplate } from '@/lib/domain/forms/forms';
import { PageTemplateList, SectionPatternList, SiteTemplateList } from './website-templates';

type Filter = 'all' | 'website' | 'pages' | 'sections' | 'forms';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'website', label: 'Website' }, { key: 'pages', label: 'Pages' },
  { key: 'sections', label: 'Sections' }, { key: 'forms', label: 'Forms' },
];

/**
 * Studio's starting points, by what they make: a website, a page, a section, a form. Each kind keeps
 * its own typed templates — one catalogue to browse, never one table of untyped payloads — and the
 * filter says which kind of thing each row would create.
 */
export function TemplatesBrowser({ organizationId, hasWebsite, siteTemplates, pageTemplates, sectionPatterns, formTemplates }: {
  organizationId: string;
  hasWebsite: boolean;
  siteTemplates: SiteTemplate[];
  pageTemplates: PageTemplate[];
  sectionPatterns: SectionPattern[];
  formTemplates: FormTemplate[];
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const show = (kind: Exclude<Filter, 'all'>) => filter === 'all' || filter === kind;
  return (
    <div className="grid gap-8">
      <div role="group" aria-label="Kind of template" className="flex flex-wrap gap-1">
        {FILTERS.map((entry) => (
          <button
            key={entry.key} type="button" aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)}
            className={cx('rounded-md border border-border px-3 py-1 text-sm transition', FOCUS_RING, filter === entry.key ? 'bg-foreground text-background' : 'text-muted hover:text-foreground')}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {show('website') ? <section aria-label="Website templates" className="grid gap-3"><h2 className="text-base font-semibold">Website</h2><SiteTemplateList organizationId={organizationId} templates={siteTemplates} hasWebsite={hasWebsite} /></section> : null}
      {show('pages') ? <section aria-label="Page templates" className="grid gap-3"><h2 className="text-base font-semibold">Pages</h2><PageTemplateList organizationId={organizationId} templates={pageTemplates} /></section> : null}
      {show('sections') ? <section aria-label="Section patterns" className="grid gap-3"><h2 className="text-base font-semibold">Sections</h2><SectionPatternList organizationId={organizationId} patterns={sectionPatterns} /></section> : null}
      {show('forms') ? <section aria-label="Form templates" className="grid gap-3"><h2 className="text-base font-semibold">Forms</h2><TemplateList organizationId={organizationId} templates={formTemplates} /></section> : null}
    </div>
  );
}
