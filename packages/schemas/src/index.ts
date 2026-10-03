import { z } from 'zod';

/**
 * What a server action validates before ever reaching the domain layer or the database — the
 * domain layer and its RLS policies remain the actual authority (a schema here is a better error
 * message, never a second place authorization is decided).
 */

export const InviteMemberSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  roleId: z.string().uuid(),
});
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

export const StartSupportSessionSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type StartSupportSessionInput = z.infer<typeof StartSupportSessionSchema>;

/**
 * A Plan key and the opaque version of the quote the person reviewed — never a price, an amount or
 * a customer id. The domain layer rebuilds the quote and refuses if it is no longer that version.
 */
export const PlatformBillingCheckoutSchema = z.object({
  organizationId: z.string().uuid(),
  planKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,60}$/),
  quoteVersion: z.string().trim().regex(/^[a-f0-9]{64}$/),
});
export type PlatformBillingCheckoutInput = z.infer<typeof PlatformBillingCheckoutSchema>;

const PublicLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  // Content editors may link only within this website. External redirects and executable URL
  // schemes are not part of the section vocabulary.
  href: z.string().trim().regex(/^(?:\/[a-z0-9\-/_]*|#[a-z][a-z0-9-]*)$/i),
}).strict();

const PublicTextItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
}).strict();

export const PublicHomepageSectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hero'),
    eyebrow: z.string().trim().min(1).max(100),
    heading: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(600),
    primaryCta: PublicLinkSchema,
    secondaryCta: PublicLinkSchema,
  }).strict(),
  z.object({
    kind: z.literal('problem'),
    heading: z.string().trim().min(1).max(240),
    paragraphs: z.array(z.string().trim().min(1).max(600)).min(1).max(4),
  }).strict(),
  z.object({
    kind: z.literal('capabilities'),
    eyebrow: z.string().trim().min(1).max(100),
    heading: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(600),
    items: z.array(PublicTextItemSchema).min(1).max(9),
  }).strict(),
  z.object({
    kind: z.literal('process'),
    eyebrow: z.string().trim().min(1).max(100),
    heading: z.string().trim().min(1).max(240),
    items: z.array(z.object({
      step: z.string().trim().min(1).max(12),
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(500),
    }).strict()).min(1).max(6),
  }).strict(),
  z.object({
    kind: z.literal('trust'),
    eyebrow: z.string().trim().min(1).max(100),
    heading: z.string().trim().min(1).max(240),
    items: z.array(PublicTextItemSchema).min(1).max(6),
  }).strict(),
  z.object({
    kind: z.literal('cta'),
    heading: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(600),
    primaryCta: PublicLinkSchema,
    secondaryCta: PublicLinkSchema,
  }).strict(),
]);

const PUBLIC_HOMEPAGE_KINDS = [
  'hero', 'problem', 'capabilities', 'process', 'trust', 'cta',
] as const;

export const PublicHomepageSectionsSchema = z.array(PublicHomepageSectionSchema)
  .length(PUBLIC_HOMEPAGE_KINDS.length)
  .superRefine((sections, context) => {
    for (const [index, kind] of PUBLIC_HOMEPAGE_KINDS.entries()) {
      if (sections[index]?.kind !== kind) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Homepage section ${index + 1} must be ${kind}.`,
        });
      }
    }
  });

export const PublicHomepageRevisionSchema = z.object({
  seoTitle: z.string().trim().min(1).max(70),
  seoDescription: z.string().trim().min(1).max(180),
  sections: PublicHomepageSectionsSchema,
}).strict();

export type PublicHomepageSection = z.infer<typeof PublicHomepageSectionSchema>;
export type PublicHomepageSections = z.infer<typeof PublicHomepageSectionsSchema>;
export type PublicHomepageRevisionInput = z.infer<typeof PublicHomepageRevisionSchema>;

export const PublicSiteProjectionSchema = z.object({
  siteId: z.string().uuid(),
  organizationId: z.string().uuid(),
  pageId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  status: z.enum(['draft', 'in_review', 'published', 'archived']).optional(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  sections: PublicHomepageSectionsSchema,
  profile: z.object({
    displayName: z.string(),
    tagline: z.string().nullable(),
    intro: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    address: z.string().nullable(),
  }).strict(),
  brand: z.object({
    accent: z.string().nullable(),
    headingFont: z.enum(['sans', 'serif', 'mono']),
    bodyFont: z.enum(['sans', 'serif', 'mono']),
    logoPath: z.string().nullable(),
  }).strict(),
}).strict();

export type PublicSiteProjection = z.infer<typeof PublicSiteProjectionSchema>;
