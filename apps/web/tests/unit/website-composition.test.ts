import { describe, expect, it } from 'vitest';
import { WebsiteContentSchema, WebsiteSectionSchema, SECTION_KINDS, type WebsiteContent } from '@gold/schemas';
import {
  addNavigationPage, addPage, addSection, blankPage, duplicatePage, duplicateSection, moveNavigationItem,
  moveSection, newId, removePage, removeSection, setHomepage, updatePage, updateSection,
} from '@/lib/domain/public-site/composition';
import { availableSlug, isServablePageSlug, pageForSlug, slugFromName } from '@/lib/domain/public-site/paths';
import { SECTION_REGISTRY } from '@/lib/domain/public-site/section-registry';

const FORM_ID = '11111111-1111-4111-8111-111111111111';

function site(): WebsiteContent {
  const home = { id: newId(), name: 'Home', slug: '', isHome: true, seoTitle: 'Home', seoDescription: 'Home', sections: [] };
  return { pages: [home], navigation: [] };
}

function sectionOf(kind: (typeof SECTION_KINDS)[number]) {
  return SECTION_REGISTRY[kind].create(newId(), { formId: FORM_ID, name: 'Quote' });
}

describe('the section registry', () => {
  it.each(SECTION_KINDS)('makes a valid %s section from its defaults', (kind) => {
    expect(WebsiteSectionSchema.safeParse(sectionOf(kind)).success).toBe(true);
  });

  it('registers exactly the kinds the vocabulary has', () => {
    expect(Object.keys(SECTION_REGISTRY).sort()).toEqual([...SECTION_KINDS].sort());
  });
});

describe('website content', () => {
  it('accepts a valid multi-page site', () => {
    let content = site();
    content = addPage(content, { ...blankPage(content, 'About'), slug: 'about' });
    content = addPage(content, { ...blankPage(content, 'Services'), slug: 'services' });
    expect(WebsiteContentSchema.safeParse(content).success).toBe(true);
  });

  it('refuses duplicate page ids, duplicate paths and reserved paths', () => {
    const base = site();
    const about = { ...blankPage(base, 'About'), slug: 'about' };
    expect(WebsiteContentSchema.safeParse({ ...base, pages: [...base.pages, about, { ...about }] }).success).toBe(false);
    expect(WebsiteContentSchema.safeParse({ ...base, pages: [...base.pages, about, { ...about, id: newId() }] }).success).toBe(false);
    for (const slug of ['portal', 'forms', 'api', 'book']) {
      expect(WebsiteContentSchema.safeParse({ ...base, pages: [...base.pages, { ...about, slug }] }).success).toBe(false);
    }
  });

  it('needs exactly one homepage, with no path of its own', () => {
    const base = site();
    expect(WebsiteContentSchema.safeParse({ ...base, pages: [{ ...base.pages[0]!, isHome: false, slug: 'x' }] }).success).toBe(false);
    expect(WebsiteContentSchema.safeParse({ ...base, pages: [{ ...base.pages[0]!, slug: 'home' }] }).success).toBe(false);
    expect(WebsiteContentSchema.safeParse({ ...base, pages: [...base.pages, { ...blankPage(base), isHome: true, slug: '' }] }).success).toBe(false);
  });

  it('refuses unknown kinds, raw html, component names and external section links', () => {
    expect(WebsiteSectionSchema.safeParse({ id: newId(), kind: 'html', heading: '<script>' }).success).toBe(false);
    expect(WebsiteSectionSchema.safeParse({ ...sectionOf('content'), html: '<b>x</b>' }).success).toBe(false);
    expect(WebsiteSectionSchema.safeParse({ ...sectionOf('content'), component: 'Evil' }).success).toBe(false);
    expect(WebsiteSectionSchema.safeParse({ ...sectionOf('cta'), primaryCta: { label: 'Leave', href: 'https://example.test' } }).success).toBe(false);
    expect(WebsiteSectionSchema.safeParse({ ...sectionOf('hero'), heading: '' }).success).toBe(false);
  });

  it('keeps navigation pointing at pages that exist', () => {
    const base = site();
    const withNav = addNavigationPage(base, base.pages[0]!.id);
    expect(WebsiteContentSchema.safeParse(withNav).success).toBe(true);
    const dangling = { ...withNav, navigation: [{ ...withNav.navigation[0]!, target: { type: 'page' as const, pageId: newId() } }] };
    expect(WebsiteContentSchema.safeParse(dangling).success).toBe(false);
    const external = { ...base, navigation: [{ id: newId(), label: 'Shop', target: { type: 'external' as const, href: 'https://shop.example.test' } }] };
    expect(WebsiteContentSchema.safeParse(external).success).toBe(true);
    expect(WebsiteContentSchema.safeParse({ ...base, navigation: [{ ...external.navigation[0]!, target: { type: 'external', href: 'javascript:alert(1)' } }] }).success).toBe(false);
  });
});

describe('composing sections', () => {
  it('adds, moves and removes sections without changing their identity', () => {
    let content = site();
    const pageId = content.pages[0]!.id;
    const hero = sectionOf('hero');
    const cta = sectionOf('cta');
    const text = sectionOf('content');
    for (const section of [hero, cta, text]) content = addSection(content, pageId, section);
    expect(content.pages[0]!.sections.map((s) => s.id)).toEqual([hero.id, cta.id, text.id]);

    content = moveSection(content, pageId, text.id, 'up');
    expect(content.pages[0]!.sections.map((s) => s.id)).toEqual([hero.id, text.id, cta.id]);
    content = moveSection(content, pageId, hero.id, 'up');
    expect(content.pages[0]!.sections.map((s) => s.id)).toEqual([hero.id, text.id, cta.id]);

    content = removeSection(content, pageId, text.id);
    expect(content.pages[0]!.sections.map((s) => s.id)).toEqual([hero.id, cta.id]);
    expect(WebsiteContentSchema.safeParse(content).success).toBe(true);
  });

  it('keeps a section\'s id when its heading changes, and gives a duplicate a new one', () => {
    let content = site();
    const pageId = content.pages[0]!.id;
    const text = sectionOf('content');
    content = addSection(content, pageId, text);
    content = updateSection(content, pageId, { ...text, heading: 'Changed' } as typeof text);
    expect(content.pages[0]!.sections[0]).toMatchObject({ id: text.id, heading: 'Changed' });
    const result = duplicateSection(content, pageId, text.id);
    expect(result.content.pages[0]!.sections).toHaveLength(2);
    expect(result.section!.id).not.toBe(text.id);
    expect(WebsiteContentSchema.safeParse(result.content).success).toBe(true);
  });

  it('allows a page with no hero and several of one kind', () => {
    let content = site();
    const pageId = content.pages[0]!.id;
    content = addSection(addSection(content, pageId, sectionOf('content')), pageId, sectionOf('content'));
    expect(WebsiteContentSchema.safeParse(content).success).toBe(true);
  });
});

describe('composing pages', () => {
  it('gives a new page a free path and keeps navigation on the page when the path changes', () => {
    let content = site();
    content = addPage(content, blankPage(content, 'Services'));
    content = addPage(content, blankPage(content, 'Services'));
    expect(content.pages.map((p) => p.slug)).toEqual(['', 'services', 'services-2']);
    const services = content.pages[1]!;
    content = addNavigationPage(content, services.id);
    content = updatePage(content, services.id, { slug: 'what-we-do' });
    expect(content.navigation[0]!.target).toEqual({ type: 'page', pageId: services.id });
    expect(WebsiteContentSchema.safeParse(content).success).toBe(true);
  });

  it('removes the navigation that pointed at a deleted page, and never the homepage', () => {
    let content = site();
    content = addPage(content, blankPage(content, 'About'));
    const about = content.pages[1]!;
    content = addNavigationPage(addNavigationPage(content, about.id), content.pages[0]!.id);
    const removal = removePage(content, about.id);
    expect(removal.content.pages).toHaveLength(1);
    expect(removal.removedNavigation).toHaveLength(1);
    expect(removal.content.navigation).toHaveLength(1);
    expect(WebsiteContentSchema.safeParse(removal.content).success).toBe(true);
    expect(removePage(content, content.pages[0]!.id).content).toBe(content);
  });

  it('moves the homepage to another page and gives the old one a path', () => {
    let content = site();
    content = addPage(content, blankPage(content, 'Welcome'));
    content = setHomepage(content, content.pages[1]!.id);
    expect(content.pages.map((p) => [p.name, p.isHome, p.slug])).toEqual([['Home', false, 'home'], ['Welcome', true, '']]);
    expect(WebsiteContentSchema.safeParse(content).success).toBe(true);
  });

  it('duplicates a page with new ids throughout', () => {
    let content = site();
    content = addSection(content, content.pages[0]!.id, sectionOf('content'));
    const result = duplicatePage(content, content.pages[0]!.id);
    const copy = result.page!;
    expect(copy.isHome).toBe(false);
    expect(copy.id).not.toBe(content.pages[0]!.id);
    expect(copy.sections[0]!.id).not.toBe(content.pages[0]!.sections[0]!.id);
    expect(WebsiteContentSchema.safeParse(result.content).success).toBe(true);
  });

  it('reorders navigation', () => {
    let content = site();
    content = addPage(addPage(content, blankPage(content, 'A')), blankPage(content, 'B'));
    content = addNavigationPage(addNavigationPage(content, content.pages[1]!.id), content.pages[2]!.id);
    const [first, second] = content.navigation;
    content = moveNavigationItem(content, second!.id, 'up');
    expect(content.navigation.map((i) => i.id)).toEqual([second!.id, first!.id]);
  });
});

describe('paths', () => {
  it('serves only a segment that could name a page and is not the platform\'s', () => {
    expect(isServablePageSlug('about')).toBe(true);
    expect(isServablePageSlug('our-services')).toBe(true);
    for (const reserved of ['forms', 'f', 'embed', 'portal', 'book', 'proposal', 'preview', 'api']) expect(isServablePageSlug(reserved)).toBe(false);
    expect(isServablePageSlug('About')).toBe(false);
    expect(isServablePageSlug('a/b')).toBe(false);
  });

  it('finds the homepage with no segment and any other page by its path', () => {
    const pages = [{ isHome: true, slug: '' }, { isHome: false, slug: 'about' }];
    expect(pageForSlug(pages, null)).toBe(pages[0]);
    expect(pageForSlug(pages, 'about')).toBe(pages[1]);
    expect(pageForSlug(pages, 'nonsense')).toBeNull();
  });

  it('makes paths from names and avoids taken and reserved ones', () => {
    expect(slugFromName('Our Services & Prices!')).toBe('our-services-prices');
    expect(slugFromName('***')).toBe('page');
    expect(availableSlug('about', ['about'])).toBe('about-2');
    expect(availableSlug('portal', [])).toBe('portal-2');
  });
});
