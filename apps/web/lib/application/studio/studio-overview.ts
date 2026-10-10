import type { Db } from '@/lib/db/types';
import { listBookableTypes } from '@/lib/domain/booking/booking';
import { getBrand } from '@/lib/domain/branding/brand';
import { getManagedHostname } from '@/lib/domain/domains/domains';
import { organizationPortalInviteCount } from '@/lib/domain/portal/portal';
import { listForms, studioResponses, type FormListEntry } from '@/lib/domain/forms/forms';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { siteEditorState } from '@/lib/domain/public-site/public-site';
import { publicProfile } from '@/lib/domain/tenancy/profile';

/**
 * What is currently public for this business, and what needs attention — the read Studio's Home
 * summarizes. One projection over state that already exists elsewhere (I4/I5's reasoning extended
 * to a summary screen): nothing here is a second website, brand, booking or portal model, and
 * nothing is stored — every figure is recomputed from its own domain's source of truth.
 */

export type StudioWebsiteState = 'not_configured' | 'draft' | 'in_review' | 'published';

export type StudioWebsiteSummary = {
  state: StudioWebsiteState;
  revisionNumber: number | null;
  publishedAt: string | null;
  preview: { id: string; number: number; status: string } | null;
  working: { id: string; number: number; status: string } | null;
};

export type StudioAttentionItem = {
  key: string;
  label: string;
};

export type StudioFormsSummary = {
  /** Forms that are not archived. */
  total: number;
  published: number;
  /** Forms with a draft nobody has published yet. */
  withDraft: number;
  responses: number;
};

export type StudioOverview = {
  /** Null when this member's role cannot see website state (the same gate `studio/website` uses). */
  website: StudioWebsiteSummary | null;
  /** Null when this member's role cannot manage forms. */
  forms: StudioFormsSummary | null;
  formPreview: FormListEntry[];
  recentResponses: Awaited<ReturnType<typeof studioResponses>>['recent'];
  recentPublishing: Array<{ id: string; number: number; status: string }>;
  suggestions: Array<{ key: string; label: string }>;
  brand: { logoConfigured: boolean; accentConfigured: boolean };
  booking: { bookableTypeCount: number; available: boolean };
  portal: { activeInviteCount: number };
  /** The GildOps-managed address this business's slug resolves to, or null until it has a slug or the deployment offers none. */
  publicUrl: string | null;
  hostname: string | null;
  attention: StudioAttentionItem[];
};

function summarizeWebsite(state: Awaited<ReturnType<typeof siteEditorState>>): StudioWebsiteSummary {
  const revision = state?.published ?? state?.working;
  const details = { preview: revision ? { id: revision.id, number: revision.number, status: revision.status } : null, working: state?.working ? { id: state.working.id, number: state.working.number, status: state.working.status } : null };
  if (!state) return { state: 'not_configured', revisionNumber: null, publishedAt: null, ...details };
  if (state.published) {
    return { state: 'published', revisionNumber: state.published.number, publishedAt: state.published.publishedAt ?? null, ...details };
  }
  if (state.working) {
    return {
      state: state.working.status === 'in_review' ? 'in_review' : 'draft',
      revisionNumber: state.working.number,
      publishedAt: null,
      ...details,
    };
  }
  return { state: 'not_configured', revisionNumber: null, publishedAt: null, ...details };
}

export async function studioOverview(
  db: Db,
  input: { organizationId: string; slug: string | null; organizationName: string; mayManageWebsite: boolean },
): Promise<StudioOverview> {
  const [siteState, forms, brand, bookableTypes, portal, managedAddress, profile, modules] = await Promise.all([
    input.mayManageWebsite ? siteEditorState(db, input.organizationId) : Promise.resolve(null),
    input.mayManageWebsite ? listForms(db, input.organizationId) : Promise.resolve(null),
    getBrand(db, { organizationId: input.organizationId }),
    listBookableTypes(db, { organizationId: input.organizationId }),
    organizationPortalInviteCount(db, { organizationId: input.organizationId }),
    getManagedHostname(db, { slug: input.slug }),
    publicProfile(db, { organizationId: input.organizationId, fallbackName: input.organizationName }),
    listUsableModules(db, { organizationId: input.organizationId }),
  ]);
  const responses = forms ? await studioResponses(db, input.organizationId, forms) : null;

  const website = input.mayManageWebsite ? summarizeWebsite(siteState) : null;

  const attention: StudioAttentionItem[] = [];
  if (website?.state === 'not_configured') attention.push({ key: 'website-not-published', label: 'No homepage has been published.' });
  if (siteState?.working?.status === 'draft') attention.push({ key: 'website-draft', label: 'Website has an unpublished draft.' });
  if (siteState?.working?.status === 'in_review') attention.push({ key: 'website-in-review', label: 'A website revision is waiting for review.' });
  const liveForms = (forms ?? []).filter((form) => !form.archived);
  const formsSummary: StudioFormsSummary | null = forms
    ? {
        total: liveForms.length,
        published: liveForms.filter((form) => form.publishedRevisionNumber !== null).length,
        withDraft: liveForms.filter((form) => form.hasDraft).length,
        responses: responses?.total ?? 0,
      }
    : null;
  if (liveForms.some((form) => form.publishedRevisionNumber === null)) attention.push({ key: 'form-unpublished', label: 'A form has never been published.' });
  if (modules.has('booking') && bookableTypes.length === 0) attention.push({ key: 'no-bookable-type', label: 'No bookable type exists.' });
  if (liveForms.some((form) => form.hasDraft && form.publishedRevisionNumber !== null)) attention.push({ key: 'form-draft', label: 'A published form has unpublished changes.' });
  // Optional polish, not an exception: a business may publish with no logo and no introduction.
  const suggestions: Array<{ key: string; label: string }> = [];
  if (!brand.logoPath) suggestions.push({ key: 'brand-logo', label: 'Add a logo to appear on your website and booking page.' });
  if (!profile.intro) suggestions.push({ key: 'profile-incomplete', label: 'Add a short introduction to your public profile.' });

  return {
    website,
    suggestions,
    forms: formsSummary,
    formPreview: (forms ?? []).slice(0, 6),
    recentResponses: responses?.recent ?? [],
    recentPublishing: (siteState?.history ?? []).slice(0, 5).map((revision) => ({
      id: revision.id,
      number: revision.number,
      status: revision.status,
    })),
    brand: { logoConfigured: Boolean(brand.logoPath), accentConfigured: Boolean(brand.accent) },
    booking: { bookableTypeCount: bookableTypes.length, available: modules.has('booking') && Boolean(input.slug) && bookableTypes.length > 0 },
    portal: { activeInviteCount: portal.active },
    publicUrl: managedAddress.state === 'ready' && siteState?.published ? `https://${managedAddress.hostname}` : null,
    hostname: managedAddress.state === 'ready' ? managedAddress.hostname : null,
    attention,
  };
}
