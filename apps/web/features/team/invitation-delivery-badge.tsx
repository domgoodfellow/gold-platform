import { Badge } from '@/components/display/data';
import type { InvitationDeliveryState } from '@/lib/domain/tenancy/invitations';

/**
 * Where an invitation email stands, in GildOps' own words — never Resend's event names, the same
 * split `DomainStateBadge` draws for a hosting provider's states.
 */
const BADGE: Record<InvitationDeliveryState, { label: string; tone: 'neutral' | 'success' | 'danger' }> = {
  queued: { label: 'Sending', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'neutral' },
  delivered: { label: 'Delivered', tone: 'success' },
  delayed: { label: 'Delivery delayed', tone: 'neutral' },
  bounced: { label: 'Bounced', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
  suppressed: { label: 'Suppressed', tone: 'danger' },
};

export function InvitationDeliveryBadge({ state }: { state: InvitationDeliveryState | null }) {
  if (state === null) return <span className="text-sm text-muted">Not sent</span>;
  const badge = BADGE[state];
  return <Badge tone={badge.tone}>{badge.label}</Badge>;
}
