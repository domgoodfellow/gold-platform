// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECTION_KINDS, WebsiteContentSchema, type SiteTemplate, type WebsiteContent, type WebsiteSection } from '@gold/schemas';
import { WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import { CreateWebsite } from '@/features/studio/website/create-website';
import { SectionEditor } from '@/features/studio/website/section-editors';
import { WebsiteWorkbench } from '@/features/studio/website/website-workbench';
import { newId } from '@/lib/domain/public-site/composition';
import { SECTION_REGISTRY } from '@/lib/domain/public-site/section-registry';
import type { EditorRevision } from '@/lib/domain/public-site/public-site';

const actions = vi.hoisted(() => {
  /** A server action as the form binds it: previous state and the submitted data in, a state out. */
  const action = <T,>(result: T) => vi.fn(async (...args: [unknown, FormData]) => { void args; return result; });
  const idle = { error: null };
  return {
    createWebsiteAction: action(idle), createDraftAction: action(idle), saveDraftAction: action({ error: null, success: 'Draft saved.' }),
    submitRevisionAction: action(idle), publishRevisionAction: action(idle),
  };
});
vi.mock('@/app/organizations/[organizationId]/studio/website/actions', () => actions);

const FORM = { id: '11111111-1111-4111-8111-111111111111', name: 'Quote', published: true };

function revision(sections: WebsiteSection[] = [], overrides: Partial<EditorRevision> = {}): EditorRevision {
  return {
    id: 'r1', number: 1, status: 'draft', createdAt: '2026-01-01T00:00:00Z',
    pages: [{ id: newId(), name: 'Home', slug: '', isHome: true, seoTitle: 'Home', seoDescription: 'Home', sections }],
    navigation: [], ...overrides,
  };
}

function renderWorkbench(working: EditorRevision | null, extra: { hasWebsite?: boolean; templates?: SiteTemplate[] } = {}) {
  return render(
    <WorkspaceRailProvider>
      <WebsiteWorkbench
        organizationId="o1" hasWebsite={extra.hasWebsite ?? true} working={working} published={null} history={[]} forms={[FORM]}
        siteTemplates={extra.templates ?? []} pageTemplates={[]} sectionPatterns={[]}
      />
    </WorkspaceRailProvider>,
  );
}

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
    expect(screen.getByText('Saved')).toBeTruthy();
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
    expect(screen.getAllByText('Kept').length).toBeGreaterThan(0);
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
