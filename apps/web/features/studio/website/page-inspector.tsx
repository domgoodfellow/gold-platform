'use client';

import { useState } from 'react';
import { PAGE_SLUG_PATTERN, RESERVED_PAGE_SLUGS, type WebsiteContent, type WebsitePage } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { navigationReferences, type PagePatch } from '@/lib/domain/public-site/composition';

/** Why this path cannot be used, in the words the business would use; null when it can. */
function slugProblem(content: WebsiteContent, page: WebsitePage, slug: string): string | null {
  if (!PAGE_SLUG_PATTERN.test(slug)) return 'Use lowercase letters, numbers and hyphens, for example our-services.';
  if (slug.length > 60) return 'Keep the path under 60 characters.';
  if ((RESERVED_PAGE_SLUGS as readonly string[]).includes(slug)) return `/${slug} is used by the platform. Choose another path.`;
  if (content.pages.some((entry) => entry.id !== page.id && !entry.isHome && entry.slug === slug)) return `Another page already uses /${slug}.`;
  return null;
}

/**
 * What a page is: its name, where it is served, what search engines are told about it, and whether
 * it is the homepage. The path is not the page's identity — navigation follows the page, so
 * changing it never breaks a link inside the website. It does change the public address, and the old
 * address is not redirected.
 */
export function PageInspector({ content, page, onChange, onSetHome, onDuplicate, onDelete, onAddToNavigation }: {
  content: WebsiteContent;
  page: WebsitePage;
  onChange: (patch: PagePatch) => void;
  onSetHome: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddToNavigation: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const references = navigationReferences(content, page.id);
  const problem = page.isHome ? null : slugProblem(content, page, page.slug);
  const problemId = `path-problem-${page.id}`;

  return (
    <div className="grid gap-4">
      <h3 className="font-semibold">Page</h3>
      <FieldLabel className="grid gap-1 text-sm">
        Name
        <TextInput value={page.name} maxLength={80} onChange={(event) => onChange({ name: event.target.value })} />
      </FieldLabel>

      {page.isHome ? (
        <Hint>This is the homepage. It is served at the root of the website.</Hint>
      ) : (
        <div className="grid gap-1">
          <FieldLabel className="grid gap-1 text-sm">
            Path
            <TextInput
              value={page.slug}
              maxLength={60}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? problemId : undefined}
              onChange={(event) => onChange({ slug: event.target.value.toLowerCase() })}
            />
          </FieldLabel>
          {problem ? <ErrorText id={problemId}>{problem}</ErrorText> : <Hint className="text-xs">Served at /{page.slug}. Changing it does not redirect the old address.</Hint>}
        </div>
      )}

      <FieldLabel className="grid gap-1 text-sm">
        SEO title
        <TextInput value={page.seoTitle} maxLength={70} onChange={(event) => onChange({ seoTitle: event.target.value })} />
      </FieldLabel>
      <FieldLabel className="grid gap-1 text-sm">
        SEO description
        <TextArea rows={3} value={page.seoDescription} maxLength={180} onChange={(event) => onChange({ seoDescription: event.target.value })} />
      </FieldLabel>

      <div className="grid gap-2 border-t border-border pt-4">
        {references.length === 0 ? (
          <div><Button type="button" tone="secondary" size="small" onClick={onAddToNavigation}>Add to navigation</Button></div>
        ) : (
          <Hint className="text-xs">In the navigation as {references.map((item) => `“${item.label}”`).join(', ')}.</Hint>
        )}
        {!page.isHome ? <div><Button type="button" tone="secondary" size="small" onClick={onSetHome}>Make this the homepage</Button></div> : null}
        <div><Button type="button" tone="secondary" size="small" onClick={onDuplicate}>Duplicate page</Button></div>
        {!page.isHome ? (
          confirmingDelete ? (
            <div className="grid gap-2 rounded-md border border-border p-3" role="alert">
              <p className="text-sm">
                Delete “{page.name}”?{references.length > 0 ? ` Its ${references.length === 1 ? 'navigation link goes' : `${references.length} navigation links go`} with it.` : ''} The published website is unchanged until you publish.
              </p>
              <div className="flex gap-2">
                <Button type="button" tone="danger" size="small" onClick={() => { setConfirmingDelete(false); onDelete(); }}>Delete page</Button>
                <Button type="button" tone="secondary" size="small" onClick={() => setConfirmingDelete(false)}>Keep page</Button>
              </div>
            </div>
          ) : (
            <div><Button type="button" tone="danger" size="small" onClick={() => setConfirmingDelete(true)}>Delete page</Button></div>
          )
        ) : null}
      </div>
    </div>
  );
}
