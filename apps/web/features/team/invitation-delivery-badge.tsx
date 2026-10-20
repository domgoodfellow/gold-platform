import { Badge } from '@/components/display/data';
import type { InvitationDeliveryState } from '@/lib/domain/tenancy/invitations';

/**
 * Where an invitation email stands, in GildOps' own words — never Resend's event names, the same
 * split `DomainStateBadge` draws for a hosting provider's states.
 */
const BADGE: Record<InvitationDeliveryState, { label: string; tone: 'neutral' | 'success' | 'danger' }> = {
  queued: { label: 'Accepted for delivery', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'neutral' },
  delivered: { label: 'Delivered', tone: 'success' },
  delayed: { label: 'Delivery delayed', tone: 'neutral' },
  bounced: { label: 'Bounced', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
  suppressed: { label: 'Suppressed', tone: 'danger' },
};

export function InvitationDeliveryBadge({ state, detail = null }: { state: InvitationDeliveryState | null; detail?: string | null }) {
  if (state === null) return <span className="text-sm text-muted">Not emailed</span>;
  const badge = BADGE[state];
  // Why it did not go, where there is a reason: a manager can act on it, or choose to share the link.
  const reason = badge.tone === 'danger' && detail ? detail : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={badge.tone}>{badge.label}</Badge>
      {reason ? <span className="text-xs text-muted">{reason}</span> : null}
    </span>
  );
}
