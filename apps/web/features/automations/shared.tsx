'use client';

import { FormError } from '@/components/controls/form';
import type { AutomationActionState } from '@/app/organizations/[organizationId]/automations/actions';

export const INITIAL_AUTOMATION_ACTION_STATE: AutomationActionState = { error: null };

/** One error renderer, shared rather than copied across every small form in this feature. */
export function ActionError({ state }: { state: AutomationActionState }) {
  return <FormError className="mt-1">{state.error}</FormError>;
}
