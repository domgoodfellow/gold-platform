import type { Database, Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { DisclosureRevision } from './service-disclosures';

export type ServiceReview = Database['public']['Tables']['service_reviews']['Row'] & { revision?: DisclosureRevision };
export const REVIEW_STATES = { pending: 'Review pending', approved: 'Approved', changes_requested: 'Changes requested', withdrawn: 'Withdrawn', superseded: 'Superseded' } as const;
export type PortalServiceReview = {
  id: string; revisionId: string; revisionNumber: number; version: number;
  state: keyof typeof REVIEW_STATES; releasedAt: string; finishedAt: string | null;
  targetTitle: string; materialAvailable: boolean; changeDescription: string | null;
};
export async function listServiceReviews(db: Db, organizationId: string, customerId: string, engagementId: string) {
  const { data, error } = await db.from('service_reviews').select('*, revision:service_disclosure_revisions(*)').eq('organization_id', organizationId).eq('customer_id', customerId).eq('engagement_id', engagementId).order('released_at', { ascending: false }).order('id').limit(50);
  if (error) throw new DomainError('Customer reviews could not be loaded.', 'service_review.read_failed');
  return data ?? [];
}
export async function releaseServiceReview(db: Db, organizationId: string, customerId: string, engagementId: string, revisionId: string, deliverableId?: string, notify?: boolean) {
  const args = { p_organization_id: organizationId, p_customer_id: customerId, p_engagement_id: engagementId, p_revision_id: revisionId, p_deliverable_id: deliverableId };
  const { data, error } = notify === undefined ? await db.rpc('release_service_review', args) : await db.rpc('release_service_review_notification', { ...args, p_notify: notify });
  if (error) throw new DomainError(error.message, 'service_review.release_failed');
  return data;
}
export async function withdrawServiceReview(db: Db, organizationId: string, customerId: string, engagementId: string, reviewId: string, version: number, notify?: boolean) {
  const args = { p_organization_id: organizationId, p_customer_id: customerId, p_engagement_id: engagementId, p_review_id: reviewId, p_expected_version: version };
  const { error } = notify === undefined ? await db.rpc('withdraw_service_review', args) : await db.rpc('withdraw_service_review_notification', { ...args, p_notify: notify });
  if (error) throw new DomainError(error.message, 'service_review.withdraw_failed');
}
export async function portalServiceReviews(db: Db, disclosureId: string): Promise<PortalServiceReview[]> {
  const { data, error } = await db.rpc('portal_service_reviews', { p_disclosure_id: disclosureId });
  if (error) throw new DomainError('Customer reviews are unavailable. Refresh your Portal or reopen your invitation.', 'service_review.unavailable');
  return data as unknown as PortalServiceReview[];
}
export async function respondServiceReview(db: Db, reviewId: string, version: number, decision: string, description?: string) {
  const { error } = await db.rpc('respond_service_review', { p_review_id: reviewId, p_expected_version: version, p_decision: decision, p_description: description });
  if (error) throw new DomainError(error.code === '42501' ? 'This review is unavailable. Refresh your Portal or reopen your invitation.' : error.message, 'service_review.response_failed');
}
