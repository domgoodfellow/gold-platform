'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { provisionPlanPriceAction, type ProvisionPriceState } from '@/app/organizations/[organizationId]/finance/plans/[planKey]/billing-actions';

const INITIAL: ProvisionPriceState = { error: null, provisioned: false };

/**
 * Provisioning one recorded price with the billing provider (Phase 4). Staff-only, gated by the
 * same `record_plan_provider_price` RPC every other narrow door in this schema uses — this
 * button is a convenience, never the guard.
 */
export function ProvisionPriceControl({
  planId,
  planKey,
  planPriceId,
  provisioned,
  environment,
}: {
  planId: string;
  planKey: string;
  planPriceId: string;
  provisioned: { productReference: string; priceReference: string } | null;
  environment: 'sandbox' | 'live' | null;
}) {
  const [state, action, pending] = useActionState(provisionPlanPriceAction, INITIAL);

  if (!environment) {
    return <Hint weight="subtle">Billing is not configured for this deployment.</Hint>;
  }

  if (provisioned) {
    return (
      <Badge tone="success" title={provisioned.priceReference}>
        Provisioned ({environment})
      </Badge>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="planKey" value={planKey} />
      <input type="hidden" name="planPriceId" value={planPriceId} />
      <Button type="submit" size="small" disabled={pending}>
        {pending ? 'Provisioning…' : `Provision in Stripe (${environment})`}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
      {state.provisioned ? <Hint role="status">Provisioned.</Hint> : null}
    </form>
  );
}
