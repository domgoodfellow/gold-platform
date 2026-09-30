import type { Db } from '@/lib/db/types';
import { listBookableTypes } from '@/lib/domain/booking/booking';
import { getBrand } from '@/lib/domain/branding/brand';
import { getManagedHostname } from '@/lib/domain/domains/domains';
import { organizationPortalInviteCount } from '@/lib/domain/portal/portal';
import { homepageEditorState } from '@/lib/domain/public-site/public-site';
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
};

export type StudioAttentionItem = {
  key: string;
  label: string;
};

export type StudioOverview = {
  /** Null when this member's role cannot see website state (the same gate `studio/website` uses). */
  website: StudioWebsiteSummary | null;
  recentPublishing: Array<{ id: string; number: number; status: string }>;
  brand: { logoConfigured: boolean; accentConfigured: boolean };
  booking: { bookableTypeCount: number };
  portal: { activeInviteCount: number };
  /** The GildOps-managed address this business's slug resolves to, or null until it has a slug or the deployment offers none. */
  publicUrl: string | null;
  attention: StudioAttentionItem[];
};

function summarizeWebsite(state: Awaited<ReturnType<typeof homepageEditorState>>): StudioWebsiteSummary {
  if (!state) return { state: 'not_configured', revisionNumber: null, publishedAt: null };
  if (state.published) {
    return { state: 'published', revisionNumber: state.published.number, publishedAt: state.published.publishedAt ?? null };
  }
  if (state.working) {
    return {
      state: state.working.status === 'in_review' ? 'in_review' : 'draft',
      revisionNumber: state.working.number,
      publishedAt: null,
    };
  }
  return { state: 'not_configured', revisionNumber: null, publishedAt: null };
}

export async function studioOverview(
  db: Db,
  input: { organizationId: string; slug: string | null; organizationName: string; mayManageWebsite: boolean },
): Promise<StudioOverview> {
  const [siteState, brand, bookableTypes, portal, managedAddress, profile] = await Promise.all([
    input.mayManageWebsite ? homepageEditorState(db, input.organizationId) : Promise.resolve(null),
    getBrand(db, { organizationId: input.organizationId }),
    listBookableTypes(db, { organizationId: input.organizationId }),
    organizationPortalInviteCount(db, { organizationId: input.organizationId }),
    getManagedHostname(db, { slug: input.slug }),
    publicProfile(db, { organizationId: input.organizationId, fallbackName: input.organizationName }),
  ]);

  const website = input.mayManageWebsite ? summarizeWebsite(siteState) : null;

  const attention: StudioAttentionItem[] = [];
  if (website?.state === 'not_configured') attention.push({ key: 'website-not-published', label: 'No homepage has been published.' });
  if (website?.state === 'draft') attention.push({ key: 'website-draft', label: 'Website has an unpublished draft.' });
  if (website?.state === 'in_review') attention.push({ key: 'website-in-review', label: 'A website revision is waiting for review.' });
  if (!brand.logoPath) attention.push({ key: 'brand-logo', label: 'Brand logo is missing.' });
  if (bookableTypes.length === 0) attention.push({ key: 'no-bookable-type', label: 'No bookable type exists.' });
  if (!profile.intro) attention.push({ key: 'profile-incomplete', label: 'Public profile is incomplete.' });

  return {
    website,
    recentPublishing: (siteState?.history ?? []).slice(0, 5).map((revision) => ({
      id: revision.id,
      number: revision.number,
      status: revision.status,
    })),
    brand: { logoConfigured: Boolean(brand.logoPath), accentConfigured: Boolean(brand.accent) },
    booking: { bookableTypeCount: bookableTypes.length },
    portal: { activeInviteCount: portal.active },
    publicUrl: managedAddress.state === 'ready' ? `https://${managedAddress.hostname}` : null,
    attention,
  };
}
