'use client';

import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { launchAction, type SetupActionState } from '@/app/organizations/[organizationId]/setup/actions';
import { Error } from './setup-controls';

const INITIAL: SetupActionState = { error: null };

/**
 * The one deliberate action that moves a business from Setup to Live. `launchOrganization`
 * re-checks readiness itself immediately before writing, so this form cannot launch a business
 * past a blocker the page merely rendered a moment earlier.
 */
export function LaunchForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(launchAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Finishing…' : 'Finish setup'}
      </Button>
      <Error state={state} />
    </form>
  );
}
