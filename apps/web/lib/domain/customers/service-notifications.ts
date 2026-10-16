import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

export const NOTIFICATION_PURPOSES = {
  service_review_requested: 'Deliverables ready for review',
  service_update_published: 'Service progress updates',
  service_review_status_changed: 'Review status changes',
} as const;
export const NOTIFICATION_STATES: Record<string, string> = {
  not_requested: 'Not requested', suppressed: 'Suppressed / ineligible', queued: 'Queued',
  accepted: 'Accepted by provider', sent: 'Sent', delivered: 'Delivered', delayed: 'Delayed',
  bounced: 'Bounced', rejected: 'Rejected', failed: 'Failed', uncertain: 'Delivery uncertain',
};
export type NotificationHistory = {
  id: string; reviewId: string | null; purpose: keyof typeof NOTIFICATION_PURPOSES;
  recipient: string | null; sender: string | null; messageId: string | null; reason: string | null;
  state: string; createdAt: string; mayRetry: boolean;
  attempts: { at: string; finishedAt: string | null; outcome: string | null; detail: string | null }[];
  events: { type: string; at: string; ingestedAt: string }[];
};
export type NotificationPreferences = { emailAddress: string; purposes: string[]; verifiedAt: string; withdrawnAt: string | null; mayWithdraw: boolean };

export async function notificationHistory(db: Db, organizationId: string, customerId: string, engagementId: string) {
  const { data, error } = await db.rpc('service_notification_history', { p_organization_id: organizationId, p_customer_id: customerId, p_engagement_id: engagementId });
  if (error) throw new DomainError('Notification history could not be loaded.', 'notification.read_failed');
  return data as unknown as NotificationHistory[];
}
export async function notificationConfiguration(db: Db, organizationId: string, customerId: string) {
  const [recipient, sender] = await Promise.all([
    db.from('customer_notification_recipients').select('email_address,purposes,verified_at,withdrawn_at').eq('organization_id', organizationId).eq('customer_id', customerId).maybeSingle(),
    db.from('customer_notification_settings').select('email_identity_id').eq('organization_id', organizationId).eq('customer_id', customerId).maybeSingle(),
  ]);
  if (recipient.error || sender.error) throw new DomainError('Notification configuration could not be loaded.', 'notification.read_failed');
  const suppression = recipient.data ? await db.from('email_recipient_suppressions').select('reason').eq('organization_id', organizationId).eq('email_address', recipient.data.email_address).maybeSingle() : null;
  if (suppression?.error) throw new DomainError('Recipient eligibility could not be loaded.', 'notification.read_failed');
  return { recipient: recipient.data, senderId: sender.data?.email_identity_id ?? null, suppressed: !!suppression?.data };
}
export async function portalNotificationPreferences(db: Db) {
  const { data, error } = await db.rpc('portal_notification_preferences');
  if (error) throw new DomainError('Email preferences are unavailable.', 'notification.read_failed');
  return data as unknown as NotificationPreferences | null;
}
