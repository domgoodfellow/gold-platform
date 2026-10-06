import {
  WebsiteSectionSchema, type NavigationItem, type PageTemplate, type SectionPattern, type WebsiteContent,
  type WebsitePage, type WebsiteSection,
} from '@gold/schemas';
import { availableSlug, slugFromName } from './paths';

/**
 * Editing a website, as pure functions from one whole content to the next. The editor holds one
 * `WebsiteContent` and every operation returns a new one, so there is a single thing to save, to
 * compare for unsaved changes, and to hand the database — never several pieces published apart.
 *
 * Nothing here decides what is valid: that is `WebsiteContentSchema` and the database's own
 * validator. These only keep the content coherent while it is being changed (a deleted page leaves
 * no navigation pointing at it; one page is always the homepage).
 */

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

function mapPage(content: WebsiteContent, pageId: string, change: (page: WebsitePage) => WebsitePage): WebsiteContent {
  return { ...content, pages: content.pages.map((page) => (page.id === pageId ? change(page) : page)) };
}

// --- sections -------------------------------------------------------------------------------

export function addSection(content: WebsiteContent, pageId: string, section: WebsiteSection, index?: number): WebsiteContent {
  return mapPage(content, pageId, (page) => {
    const at = index === undefined ? page.sections.length : Math.max(0, Math.min(index, page.sections.length));
    return { ...page, sections: [...page.sections.slice(0, at), section, ...page.sections.slice(at)] };
  });
}

export function updateSection(content: WebsiteContent, pageId: string, section: WebsiteSection): WebsiteContent {
  return mapPage(content, pageId, (page) => ({ ...page, sections: page.sections.map((entry) => (entry.id === section.id ? section : entry)) }));
}

export function removeSection(content: WebsiteContent, pageId: string, sectionId: string): WebsiteContent {
  return mapPage(content, pageId, (page) => ({ ...page, sections: page.sections.filter((entry) => entry.id !== sectionId) }));
}

/** Moving never changes a section's identity: it is the same section, somewhere else. */
export function moveSection(content: WebsiteContent, pageId: string, sectionId: string, direction: 'up' | 'down'): WebsiteContent {
  return mapPage(content, pageId, (page) => {
    const from = page.sections.findIndex((entry) => entry.id === sectionId);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= page.sections.length) return page;
    const sections = [...page.sections];
    [sections[from], sections[to]] = [sections[to]!, sections[from]!];
    return { ...page, sections };
  });
}

/** The copy sits directly after the original and is a different section. */
export function duplicateSection(content: WebsiteContent, pageId: string, sectionId: string): { content: WebsiteContent; section: WebsiteSection | null } {
  const page = content.pages.find((entry) => entry.id === pageId);
  const index = page?.sections.findIndex((entry) => entry.id === sectionId) ?? -1;
  if (!page || index < 0) return { content, section: null };
  const copy = { ...page.sections[index]!, id: newId() } as WebsiteSection;
  return { content: addSection(content, pageId, copy, index + 1), section: copy };
}

/** A pattern becomes a real section of a registered kind; nothing keeps pointing back at the pattern. */
export function sectionFromPattern(pattern: SectionPattern): WebsiteSection {
  return WebsiteSectionSchema.parse({ ...pattern.section, id: newId() });
}

// --- pages ----------------------------------------------------------------------------------

function takenSlugs(content: WebsiteContent, except?: string): string[] {
  return content.pages.filter((page) => !page.isHome && page.id !== except).map((page) => page.slug);
}

export function blankPage(content: WebsiteContent, name = 'New page'): WebsitePage {
  return {
    id: newId(), name, slug: availableSlug(slugFromName(name), takenSlugs(content)), isHome: false,
    seoTitle: name.slice(0, 70), seoDescription: name.slice(0, 180), sections: [],
  };
}

/** A copy of a page template: fresh ids, validated sections, no link back. */
export function pageFromTemplate(content: WebsiteContent, template: PageTemplate): WebsitePage {
  const source = template.page;
  return {
    id: newId(), name: source.name, slug: availableSlug(source.slug || slugFromName(source.name), takenSlugs(content)), isHome: false,
    seoTitle: source.seoTitle, seoDescription: source.seoDescription,
    sections: source.sections.map((section) => WebsiteSectionSchema.parse({ ...section, id: newId() })),
  };
}

export function addPage(content: WebsiteContent, page: WebsitePage): WebsiteContent {
  return { ...content, pages: [...content.pages, page] };
}

export function duplicatePage(content: WebsiteContent, pageId: string): { content: WebsiteContent; page: WebsitePage | null } {
  const source = content.pages.find((page) => page.id === pageId);
  if (!source) return { content, page: null };
  const name = `${source.name} copy`.slice(0, 80);
  const page: WebsitePage = {
    ...source, id: newId(), name, isHome: false,
    slug: availableSlug(slugFromName(name), takenSlugs(content)),
    sections: source.sections.map((section) => ({ ...section, id: newId() }) as WebsiteSection),
  };
  return { content: addPage(content, page), page };
}

export type PagePatch = Partial<Pick<WebsitePage, 'name' | 'seoTitle' | 'seoDescription' | 'slug'>>;

export function updatePage(content: WebsiteContent, pageId: string, patch: PagePatch): WebsiteContent {
  return mapPage(content, pageId, (page) => ({ ...page, ...patch, slug: page.isHome ? '' : (patch.slug ?? page.slug) }));
}

/** One page is the homepage; the page it replaces takes a path of its own from its name. */
export function setHomepage(content: WebsiteContent, pageId: string): WebsiteContent {
  const previous = content.pages.find((page) => page.isHome);
  if (!previous || previous.id === pageId) return content;
  const slug = availableSlug(slugFromName(previous.name), takenSlugs(content, pageId));
  return {
    ...content,
    pages: content.pages.map((page) => {
      if (page.id === pageId) return { ...page, isHome: true, slug: '' };
      if (page.id === previous.id) return { ...page, isHome: false, slug };
      return page;
    }),
  };
}

export type PageRemoval = { content: WebsiteContent; removedNavigation: NavigationItem[] };

/** The homepage cannot be removed. Navigation that pointed at the page goes with it, in the same change. */
export function removePage(content: WebsiteContent, pageId: string): PageRemoval {
  const page = content.pages.find((entry) => entry.id === pageId);
  if (!page || page.isHome) return { content, removedNavigation: [] };
  const removedNavigation = navigationReferences(content, pageId);
  return {
    content: {
      pages: content.pages.filter((entry) => entry.id !== pageId),
      navigation: content.navigation.filter((item) => !removedNavigation.includes(item)),
    },
    removedNavigation,
  };
}

export function navigationReferences(content: WebsiteContent, pageId: string): NavigationItem[] {
  return content.navigation.filter((item) => item.target.type === 'page' && item.target.pageId === pageId);
}

// --- navigation -----------------------------------------------------------------------------

export function addNavigationPage(content: WebsiteContent, pageId: string): WebsiteContent {
  const page = content.pages.find((entry) => entry.id === pageId);
  if (!page) return content;
  const item: NavigationItem = { id: newId(), label: page.name.slice(0, 60), target: { type: 'page', pageId } };
  return { ...content, navigation: [...content.navigation, item] };
}

export function addNavigationExternal(content: WebsiteContent, label = 'Link', href = 'https://'): WebsiteContent {
  const item: NavigationItem = { id: newId(), label, target: { type: 'external', href } };
  return { ...content, navigation: [...content.navigation, item] };
}

export function updateNavigationItem(content: WebsiteContent, item: NavigationItem): WebsiteContent {
  return { ...content, navigation: content.navigation.map((entry) => (entry.id === item.id ? item : entry)) };
}

export function removeNavigationItem(content: WebsiteContent, itemId: string): WebsiteContent {
  return { ...content, navigation: content.navigation.filter((entry) => entry.id !== itemId) };
}

export function moveNavigationItem(content: WebsiteContent, itemId: string, direction: 'up' | 'down'): WebsiteContent {
  const from = content.navigation.findIndex((entry) => entry.id === itemId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= content.navigation.length) return content;
  const navigation = [...content.navigation];
  [navigation[from], navigation[to]] = [navigation[to]!, navigation[from]!];
  return { ...content, navigation };
}
