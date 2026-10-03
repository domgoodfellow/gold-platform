'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  beginPlatformBillingCheckoutAction,
  beginPlatformBillingPortalAction,
  type PlatformBillingActionState,
} from '@/app/organizations/[organizationId]/settings/plan/actions';

const INITIAL: PlatformBillingActionState = { error: null };

/**
 * Starting a GOLD subscription for the Plan already assigned to this business. There is no Plan
 * picker here (Phase 7's "choose plan" step) — which Plan an organization may subscribe to is
 * still a staff-assigned entitlement fact (`organization_plan_assignments`), not a self-service
 * catalog browse, so this offers exactly the one Plan already on file rather than inventing a
 * second, unstaffed path to change entitlement.
 */
export function SubscribeButton({
  organizationId,
  planKey,
  planLabel,
  quoteVersion,
}: {
  organizationId: string;
  planKey: string;
  planLabel: string;
  /** The opaque version of the quote shown beside this button -- what the person reviewed. */
  quoteVersion: string;
}) {
  const [state, action, pending] = useActionState(beginPlatformBillingCheckoutAction, INITIAL);

  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="planKey" value={planKey} />
      <input type="hidden" name="quoteVersion" value={quoteVersion} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Starting…' : `Subscribe to ${planLabel}`}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function ManageBillingButton({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(beginPlatformBillingPortalAction, INITIAL);

  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Button type="submit" tone="secondary" disabled={pending}>
        {pending ? 'Opening…' : 'Manage billing'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
