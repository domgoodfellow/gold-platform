// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECTION_KINDS, WebsiteContentSchema, type SiteTemplate, type WebsiteContent, type WebsiteSection } from '@gold/schemas';
import { PagePanel, WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import { CreateWebsite } from '@/features/studio/website/create-website';
import { SectionEditor } from '@/features/studio/website/section-editors';
import { WebsiteWorkbench } from '@/features/studio/website/website-workbench';
import { newId } from '@/lib/domain/public-site/composition';
import { SECTION_REGISTRY } from '@/lib/domain/public-site/section-registry';
import type { EditorRevision, RevisionHistoryEntry } from '@/lib/domain/public-site/public-site';

const actions = vi.hoisted(() => {
  /** A server action as the form binds it: previous state and the submitted data in, a state out. */
  const action = <T,>(result: T) => vi.fn(async (...args: [unknown, FormData]) => { void args; return result; });
  const idle = { error: null };
  return {
    createWebsiteAction: action(idle), createDraftAction: action(idle), saveDraftAction: action({ error: null, success: 'Draft saved.' }),
    submitRevisionAction: action(idle), publishRevisionAction: action(idle), discardDraftAction: action(idle),
  };
});
vi.mock('@/app/organizations/[organizationId]/studio/website/actions', () => actions);

const FORM = { id: '11111111-1111-4111-8111-111111111111', name: 'Quote', published: true };
const FRAME = {
  experience: 'organization_website' as const,
  profile: { displayName: 'Acme', tagline: null, intro: null, contactEmail: null, contactPhone: null, address: null },
  brand: { accent: null, headingFont: 'sans' as const, bodyFont: 'sans' as const, logoPath: null },
  logoSrc: null,
};

function revision(sections: WebsiteSection[] = [], overrides: Partial<EditorRevision> = {}): EditorRevision {
  return {
    id: 'r1', number: 1, status: 'draft', createdAt: '2026-01-01T00:00:00Z', createdSource: 'account',
    pages: [{ id: newId(), name: 'Home', slug: '', isHome: true, seoTitle: 'Home', seoDescription: 'Home', sections }],
    navigation: [], baseRevisionId: null, baseRevisionNumber: null, copiedFromRevisionId: null, copiedFromRevisionNumber: null, stale: false,
    ...overrides,
  };
}

function renderWorkbench(working: EditorRevision | null, extra: { hasWebsite?: boolean; templates?: SiteTemplate[]; published?: EditorRevision | null; history?: RevisionHistoryEntry[]; panel?: 'history' } = {}) {
  return render(
    <WorkspaceRailProvider>
      <WebsiteWorkbench
        organizationId="o1" timezone="America/Toronto" hasWebsite={extra.hasWebsite ?? true} frame={FRAME} working={working} published={extra.published ?? null}
        history={extra.history ?? []} forms={[FORM]} initialPanel={extra.panel ?? null}
        siteTemplates={extra.templates ?? []} pageTemplates={[]} sectionPatterns={[]}
      />
      <PagePanel />
    </WorkspaceRailProvider>,
  );
}

const entry = (revision: EditorRevision, extra: Partial<RevisionHistoryEntry> = {}): RevisionHistoryEntry => ({
  id: revision.id, number: revision.number, status: revision.status, createdAt: revision.createdAt, createdSource: revision.createdSource,
  publishedAt: revision.publishedAt ?? null, archivedAt: null, discardedAt: null, copiedFromRevisionNumber: revision.copiedFromRevisionNumber, ...extra,
});

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  Object.values(actions).forEach((mock) => mock.mockClear());
});
afterEach(cleanup);

const structure = () => screen.getByRole('navigation', { name: 'Website structure' });
const sectionRows = () => within(screen.getByRole('list', { name: /^Sections of/ })).getAllByRole('listitem').map((row) => row.querySelector('button')?.textContent).filter((text) => text && text !== 'Add section');

describe('the empty state', () => {
  it('offers to create a website, blank or from a starter, instead of a dead end', () => {
    const template = { key: 'local_service', name: 'Local service business', description: 'D', category: 'Service', pages: [{ name: 'Home', slug: '', isHome: true, seoTitle: 'x', seoDescription: 'y', sections: [] }], navigation: [] };
    renderWorkbench(null, { hasWebsite: false, templates: [template] });
    expect(screen.getByRole('button', { name: /Create blank website/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Use template: Local service business/ })).toBeTruthy();
    expect(screen.queryByText(/No website is configured/)).toBeNull();
  });

  it('submits the chosen starter\'s key and the organization, never a hostname', async () => {
    const user = userEvent.setup();
    render(<CreateWebsite organizationId="o1" templates={[]} />);
    await user.click(screen.getByRole('button', { name: /Create blank website/ }));
    const data = actions.createWebsiteAction.mock.calls[0]![1];
    expect(data.get('organizationId')).toBe('o1');
    expect(data.get('templateKey')).toBe('');
    expect([...data.keys()]).not.toContain('hostname');
  });
});

describe('composing a page', () => {
  it('adds a page, selects it, and marks the draft unsaved', async () => {
    const user = userEvent.setup();
    renderWorkbench(revision());
    expect(screen.getByText(/^Draft created/)).toBeTruthy();
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.type(screen.getByLabelText('Page name'), 'About us');
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    expect(within(structure()).getByText('/about-us')).toBeTruthy();
    expect((screen.getByLabelText('Path') as HTMLInputElement).value).toBe('about-us');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('removes and reorders sections with buttons, keeping the others', async () => {
    const user = userEvent.setup();
    const [a, b, c] = [SECTION_REGISTRY.hero.create(newId()), SECTION_REGISTRY.content.create(newId()), SECTION_REGISTRY.cta.create(newId())];
    renderWorkbench(revision([a, b, c]));
    expect(sectionRows()).toEqual(['Hero', 'Text', 'Closing action']);
    await user.click(within(structure()).getByRole('button', { name: 'Move Closing action up' }));
    expect(sectionRows()).toEqual(['Hero', 'Closing action', 'Text']);
    await user.click(within(structure()).getByRole('button', { name: 'Remove Text' }));
    expect(sectionRows()).toEqual(['Hero', 'Closing action']);
    await user.click(within(structure()).getByRole('button', { name: 'Duplicate Hero' }));
    expect(sectionRows()).toEqual(['Hero', 'Hero', 'Closing action']);
  });

  it('keeps unsaved edits when moving between pages', async () => {
    const user = userEvent.setup();
    renderWorkbench(revision([SECTION_REGISTRY.content.create(newId())]));
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.click(within(structure()).getByRole('button', { name: /^Home/ }));
    await user.click(within(structure()).getByRole('button', { name: 'Text' }));
    await user.clear(screen.getByLabelText('Heading'));
    await user.type(screen.getByLabelText('Heading'), 'Kept');
    await user.click(within(structure()).getByRole('button', { name: /^New page/ }));
    await user.click(within(structure()).getByRole('button', { name: /^Home/ }));
    // The canvas draws the page in an isolated frame, which jsdom does not load; what it draws is
    // proven in the browser (e2e/studio-stabilization.spec.ts). The edit is still the section's content.
    await user.click(within(structure()).getByRole('button', { name: 'Text' }));
    expect((screen.getByLabelText('Heading') as HTMLInputElement).value).toBe('Kept');
  });

  it('saves one whole website: every page and the navigation, as valid content', async () => {
    const user = userEvent.setup();
    renderWorkbench(revision());
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.click(screen.getByRole('button', { name: 'Add to navigation' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const data = actions.saveDraftAction.mock.calls[0]![1];
    const content = JSON.parse(String(data.get('content'))) as WebsiteContent;
    expect(content.pages).toHaveLength(2);
    expect(content.navigation).toHaveLength(1);
    expect(WebsiteContentSchema.safeParse(content).success).toBe(true);
  });

  it('says why a reserved path cannot be used', async () => {
    const user = userEvent.setup();
    renderWorkbench(revision());
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    const path = screen.getByLabelText('Path');
    await user.clear(path);
    await user.type(path, 'portal');
    expect(screen.getByText(/\/portal is used by the platform/)).toBeTruthy();
    expect(path.getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses to delete a page without being asked twice, and takes its navigation with it', async () => {
    const user = userEvent.setup();
    renderWorkbench(revision());
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.click(within(structure()).getByRole('button', { name: 'Add page' }));
    await user.click(screen.getByRole('button', { name: 'Add to navigation' }));
    await user.click(screen.getByRole('button', { name: 'Delete page' }));
    expect(screen.getByRole('alert').textContent).toMatch(/navigation link goes with it/);
    await user.click(screen.getByRole('button', { name: 'Delete page' }));
    expect(within(structure()).queryByText('/new-page')).toBeNull();
  });

  it('is read-only while in review and offers publishing', () => {
    renderWorkbench(revision([], { status: 'in_review' }));
    expect(screen.getByText('Read-only while in review')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect((within(structure()).getByRole('button', { name: 'Add page' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('editing a section', () => {
  it.each(SECTION_KINDS)('has an editor for %s that changes only what it shows', async (kind) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const section = SECTION_REGISTRY[kind].create(newId(), { formId: FORM.id, name: FORM.name });
    render(<SectionEditor section={section} onChange={onChange} organizationId="o1" forms={[FORM]} />);
    const heading = screen.getByLabelText('Heading');
    await user.type(heading, 'X');
    expect(onChange).toHaveBeenCalled();
    const changed = onChange.mock.calls.at(-1)![0] as WebsiteSection;
    expect(changed.id).toBe(section.id);
    expect(changed.kind).toBe(kind);
  });
});

describe('the revision lifecycle', () => {
  const published = revision([], { id: 'r7', number: 7, status: 'published', createdSource: 'migration', publishedAt: '2026-11-09T12:00:00Z' });
  const archived = revision([], { id: 'r3', number: 3, status: 'archived', publishedAt: '2026-09-01T12:00:00Z' });
  const stale = revision([], { id: 'r4', number: 4, createdAt: '2026-09-30T14:00:00Z', stale: true });
  const history = [entry(published), entry(stale), entry(archived, { archivedAt: '2026-11-08T12:00:00Z' })];

  it('names the working and published revisions apart and warns about a stale draft', () => {
    renderWorkbench(stale, { published, history });
    expect(screen.getByText('Revision 4 · Draft')).toBeTruthy();
    expect(screen.getByText('Revision 7 is published (by a GildOps release)')).toBeTruthy();
    expect(screen.getByText(/^Draft created/)).toBeTruthy();
    expect(screen.getByText('Draft is based on an older revision.')).toBeTruthy();
    expect(screen.getByText('Publishing this draft would replace revision 7.')).toBeTruthy();
  });

  it('does not warn about a draft that is current', () => {
    renderWorkbench(revision([], { id: 'r8', number: 8, baseRevisionId: 'r7', baseRevisionNumber: 7 }), { published, history });
    expect(screen.queryByText('Draft is based on an older revision.')).toBeNull();
  });

  it('discards the persisted draft only after confirming, naming it', async () => {
    const user = userEvent.setup();
    renderWorkbench(stale, { published, history });
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(actions.discardDraftAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/stays in history and can be restored. The published website does not change/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Discard revision 4' }));
    const data = actions.discardDraftAction.mock.calls[0]![1];
    expect(data.get('revisionId')).toBe('r4');
    expect(data.get('organizationId')).toBe('o1');
  });

  it('publishes a stale revision in review only after confirming it replaces the newer one', async () => {
    const user = userEvent.setup();
    renderWorkbench({ ...stale, status: 'in_review' }, { published, history });
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(actions.publishRevisionAction).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace revision 7' }));
    const data = actions.publishRevisionAction.mock.calls[0]![1];
    expect(data.get('replaceNewer')).toBe('true');
    expect(data.get('revisionId')).toBe('r4');
  });

  it('publishes a current revision in review directly, without replacing anything', async () => {
    const user = userEvent.setup();
    renderWorkbench(revision([], { id: 'r8', number: 8, status: 'in_review', baseRevisionId: 'r7' }), { published, history });
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(actions.publishRevisionAction.mock.calls[0]![1].get('replaceNewer')).toBeNull();
  });

  it('opens history from a link, labels the published and working revisions, and blocks restoring while a draft is open', () => {
    renderWorkbench(stale, { published, history, panel: 'history' });
    const list = screen.getByRole('list', { name: 'Revisions' });
    expect(within(list).getByText('Live')).toBeTruthy();
    expect(within(list).getByText('Working')).toBeTruthy();
    expect(screen.getByText('Discard or publish the working draft to restore an earlier revision.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Restore revision 3 as a draft' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('restores an earlier revision once no draft is open', async () => {
    const user = userEvent.setup();
    renderWorkbench(null, { published, history: [entry(published), entry({ ...stale, status: 'discarded' }, { discardedAt: '2026-11-24T12:00:00Z' }), entry(archived)], panel: 'history' });
    expect(screen.getByText(/^Discarded Nov/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore revision 3 as a draft' }));
    expect(actions.createDraftAction.mock.calls[0]![1].get('fromRevisionId')).toBe('r3');
    // The discarded draft can come back the same way.
    expect((screen.getByRole('button', { name: 'Restore revision 4 as a draft' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
