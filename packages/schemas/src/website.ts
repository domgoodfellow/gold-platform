import { z } from 'zod';
import { FormPublicationSchema } from './forms';

/**
 * The website vocabulary: a Site is pages, a Page is an ordered list of typed sections, and
 * navigation names a page by its stable id. This is a better error message at the trust boundary,
 * never a second authorization — `app.public_site_content_problem` in PostgreSQL is authoritative
 * for every writer and `public-site-schema.test.ts` keeps the two agreeing.
 *
 * The vocabulary is closed on purpose. There is no HTML, component name, script, style or arbitrary
 * URL field; text is text and React escapes it. A link may point only within the website.
 */

/**
 * A path inside this website, optionally followed by an anchor (`/products#booking`), or an anchor
 * on the same page (`#contact`). `app.public_internal_href_ok` repeats this in the database.
 */
const InternalHrefSchema = z.string().trim().regex(/^(?:\/[A-Za-z0-9\-/_]*(?:#[A-Za-z][A-Za-z0-9-]*)?|#[A-Za-z][A-Za-z0-9-]*)$/);

const PublicLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  // Content editors may link only within this website. External redirects and executable URL
  // schemes are not part of the section vocabulary.
  href: InternalHrefSchema,
}).strict();

const PublicTextItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
}).strict();

/** A card in a `capabilities` section. Its title is the link text when it has a link. */
const PublicCardItemSchema = PublicTextItemSchema.extend({ href: InternalHrefSchema.optional() }).strict();

/** How a `capabilities` section lays out its cards. Absent means `cards`, the original layout. */
export const CAPABILITIES_VARIANTS = ['cards', 'list'] as const;

const id = z.string().uuid();
/** An eyebrow is a small label above a heading; a business may not want one. */
const eyebrow = z.string().trim().max(100);

export const HERO_VARIANTS = ['centered', 'left', 'preview'] as const;

/**
 * Every kind of section a page can hold. One entry per kind: adding a kind is adding one here, one
 * branch in `app.public_section_problem`, one definition in the section registry, one renderer and
 * one editor — and each of those is a map keyed by this union, so the compiler lists what is missing.
 */
export const WebsiteSectionSchema = z.discriminatedUnion('kind', [
  // A reference to a form, never a copy of one: the fields are read from the form's published
  // revision when the page is served.
  z.object({
    id, kind: z.literal('form'),
    heading: z.string().trim().min(1).max(240),
    body: z.string().max(600),
    formId: z.string().uuid(),
  }).strict(),
  z.object({
    id, kind: z.literal('hero'),
    variant: z.enum(HERO_VARIANTS),
    eyebrow,
    heading: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(600),
    primaryCta: PublicLinkSchema,
    secondaryCta: PublicLinkSchema.optional(),
  }).strict(),
  z.object({
    id, kind: z.literal('problem'),
    heading: z.string().trim().min(1).max(240),
    paragraphs: z.array(z.string().trim().min(1).max(600)).min(1).max(4),
  }).strict(),
  z.object({
    id, kind: z.literal('content'),
    eyebrow,
    heading: z.string().trim().min(1).max(240),
    paragraphs: z.array(z.string().trim().min(1).max(800)).min(1).max(6),
  }).strict(),
  z.object({
    id, kind: z.literal('capabilities'),
    variant: z.enum(CAPABILITIES_VARIANTS).optional(),
    eyebrow,
    heading: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(600),
    items: z.array(PublicCardItemSchema).min(1).max(9),
  }).strict(),
  z.object({
    id, kind: z.literal('process'),
    eyebrow,
    heading: z.string().trim().min(1).max(240),
    items: z.array(z.object({
      step: z.string().trim().min(1).max(12),
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(500),
    }).strict()).min(1).max(6),
  }).strict(),
  z.object({
    id, kind: z.literal('trust'),
    eyebrow,
    heading: z.string().trim().min(1).max(240),
    items: z.array(PublicTextItemSchema).min(1).max(6),
  }).strict(),
  z.object({
    id, kind: z.literal('cta'),
    heading: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(600),
    primaryCta: PublicLinkSchema,
    secondaryCta: PublicLinkSchema.optional(),
  }).strict(),
]);

export type WebsiteSection = z.infer<typeof WebsiteSectionSchema>;
export type SectionKind = WebsiteSection['kind'];
export type SectionOf<K extends SectionKind> = Extract<WebsiteSection, { kind: K }>;
export type PublicLink = z.infer<typeof PublicLinkSchema>;

/** Every kind, in the order the chooser lists them when it has no better one. */
export const SECTION_KINDS = ['hero', 'content', 'capabilities', 'process', 'trust', 'problem', 'form', 'cta'] as const satisfies readonly SectionKind[];

/**
 * Single-segment paths that already mean something on a business's own hostname. A page may not
 * take one. `app.public_site_reserved_slugs()` repeats this list in the database and a test
 * compares them.
 */
export const RESERVED_PAGE_SLUGS = [
  'forms', 'f', 'embed', 'portal', 'book', 'proposal', 'preview', 'api', 'auth', 'connect',
  'organizations', 'platform', 'settings', 'sites', 'login', 'sign-up', 'forgot-password',
  'reset-password', 'sign-in', 'sign-out', 'workflow-review',
] as const;

export const PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const WebsitePageSchema = z.object({
  /** A page's identity. Its path may change; navigation and everything else refer to this. */
  id,
  name: z.string().trim().min(1).max(80),
  /** The path below the site's root, one segment. The homepage has none: it lives at the root. */
  slug: z.string().max(60),
  isHome: z.boolean(),
  seoTitle: z.string().trim().min(1).max(70),
  seoDescription: z.string().trim().min(1).max(180),
  sections: z.array(WebsiteSectionSchema).max(60),
}).strict();

export type WebsitePage = z.infer<typeof WebsitePageSchema>;

export const NavigationTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), pageId: id }).strict(),
  // An external link is its own typed thing, never a URL typed into a page's slot.
  z.object({ type: z.literal('external'), href: z.string().trim().regex(/^https:\/\/[^\s<>"]{3,250}$/) }).strict(),
]);

export const NavigationItemSchema = z.object({
  id,
  label: z.string().trim().min(1).max(60),
  target: NavigationTargetSchema,
}).strict();

export type NavigationItem = z.infer<typeof NavigationItemSchema>;
export type NavigationTarget = z.infer<typeof NavigationTargetSchema>;

/** Why this content cannot be saved, in words a person can act on; null when it can. */
export function websiteContentProblem(content: { pages: WebsitePage[]; navigation: NavigationItem[] }): string | null {
  const pageIds = new Set<string>();
  const slugs = new Set<string>();
  const sectionIds = new Set<string>();
  let homes = 0;
  for (const page of content.pages) {
    if (pageIds.has(page.id)) return 'Two pages share an id.';
    pageIds.add(page.id);
    if (page.isHome) {
      homes += 1;
      if (page.slug !== '') return 'The homepage lives at the root and has no path of its own.';
    } else {
      if (!PAGE_SLUG_PATTERN.test(page.slug)) return `The path of “${page.name}” may use lowercase letters, numbers and hyphens.`;
      if ((RESERVED_PAGE_SLUGS as readonly string[]).includes(page.slug)) return `/${page.slug} is used by the platform. Choose another path for “${page.name}”.`;
      if (slugs.has(page.slug)) return `Two pages use the path /${page.slug}.`;
      slugs.add(page.slug);
    }
    for (const section of page.sections) {
      if (sectionIds.has(section.id)) return 'Two sections share an id.';
      sectionIds.add(section.id);
    }
  }
  if (homes !== 1) return 'A website has exactly one homepage.';
  const itemIds = new Set<string>();
  for (const item of content.navigation) {
    if (itemIds.has(item.id)) return 'Two navigation items share an id.';
    itemIds.add(item.id);
    if (item.target.type === 'page' && !pageIds.has(item.target.pageId)) return `“${item.label}” points at a page that no longer exists.`;
  }
  return null;
}

export const WebsiteContentSchema = z.object({
  pages: z.array(WebsitePageSchema).min(1).max(50),
  navigation: z.array(NavigationItemSchema).max(20),
}).strict().superRefine((content, context) => {
  const problem = websiteContentProblem(content);
  if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

export type WebsiteContent = z.infer<typeof WebsiteContentSchema>;

const ProfileSchema = z.object({
  displayName: z.string(),
  tagline: z.string().nullable(),
  intro: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: z.string().nullable(),
}).strict();

const BrandSchema = z.object({
  accent: z.string().nullable(),
  headingFont: z.enum(['sans', 'serif', 'mono']),
  bodyFont: z.enum(['sans', 'serif', 'mono']),
  logoPath: z.string().nullable(),
}).strict();

/**
 * One whole website at one revision: every page, the navigation, and the published forms the
 * sections name. A page is chosen from it by the caller, so a single read can never mix revisions.
 */
export const PublicWebsiteSnapshotSchema = z.object({
  siteId: z.string().uuid(),
  organizationId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  status: z.enum(['draft', 'in_review', 'published', 'archived']),
  pages: z.array(WebsitePageSchema),
  navigation: z.array(NavigationItemSchema),
  /** The published forms the sections name, by form id — read from the forms, not stored in the website. */
  forms: z.record(z.string().uuid(), FormPublicationSchema).default({}),
  profile: ProfileSchema,
  brand: BrandSchema,
}).strict();

export type PublicWebsiteSnapshot = z.infer<typeof PublicWebsiteSnapshotSchema>;

/** GildOps' own root: the home page of its published site, which is all the platform root renders. */
export const PublicSiteProjectionSchema = z.object({
  siteId: z.string().uuid(),
  organizationId: z.string().uuid(),
  pageId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  sections: z.array(WebsiteSectionSchema),
  forms: z.record(z.string().uuid(), FormPublicationSchema).default({}),
  profile: ProfileSchema,
  brand: BrandSchema,
}).strict();

export type PublicSiteProjection = z.infer<typeof PublicSiteProjectionSchema>;

/** A starting point. Templates carry no ids and name their navigation targets by slug. */
export const SiteTemplateSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  pages: z.array(z.object({
    name: z.string(), slug: z.string(), isHome: z.boolean(), seoTitle: z.string(), seoDescription: z.string(),
    sections: z.array(z.record(z.string(), z.unknown())),
  })),
  navigation: z.array(z.object({
    label: z.string(),
    target: z.object({ type: z.literal('page'), slug: z.string() }),
  })),
});
export type SiteTemplate = z.infer<typeof SiteTemplateSchema>;

export const PageTemplateSchema = z.object({
  key: z.string(), name: z.string(), description: z.string(), category: z.string(),
  page: z.object({
    name: z.string(), slug: z.string(), isHome: z.boolean(), seoTitle: z.string(), seoDescription: z.string(),
    sections: z.array(z.record(z.string(), z.unknown())),
  }),
});
export type PageTemplate = z.infer<typeof PageTemplateSchema>;

export const SectionPatternSchema = z.object({
  key: z.string(), name: z.string(), description: z.string(),
  kind: z.enum(['hero', 'problem', 'content', 'capabilities', 'process', 'trust', 'cta']),
  section: z.record(z.string(), z.unknown()),
});
export type SectionPattern = z.infer<typeof SectionPatternSchema>;

export const SiteTemplatesSchema = z.array(SiteTemplateSchema);
export const PageTemplatesSchema = z.array(PageTemplateSchema);
export const SectionPatternsSchema = z.array(SectionPatternSchema);

const RevisionSchema = z.object({
  id: z.string().uuid(), number: z.number().int(), status: z.enum(['draft', 'in_review', 'published', 'archived']),
  pages: z.array(WebsitePageSchema), navigation: z.array(NavigationItemSchema), createdAt: z.string(),
  submittedAt: z.string().nullable().optional(), publishedAt: z.string().nullable().optional(),
});

/** What the editor reads: the published revision, the one working revision, and the history. */
export const WebsiteEditorStateSchema = z.object({
  siteId: z.string().uuid(),
  published: RevisionSchema.nullable(),
  working: RevisionSchema.nullable(),
  history: z.array(z.object({
    id: z.string().uuid(), number: z.number().int(), status: z.string(), createdAt: z.string(),
    publishedAt: z.string().nullable(), archivedAt: z.string().nullable(),
  })),
});
