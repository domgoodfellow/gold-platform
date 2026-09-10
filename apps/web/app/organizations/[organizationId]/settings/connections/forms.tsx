'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { RECORD_DOMAIN_INITIAL, recordEmailDomainAction } from './actions';

/** A business naming its own sending domain. Nothing here proposes one. */
export function AddEmailDomainForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(recordEmailDomainAction, RECORD_DOMAIN_INITIAL);

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          name="domain"
          type="text"
          required
          autoComplete="off"
          placeholder="mail.yourbusiness.com"
          aria-label="Sending domain"
          className="w-64"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add domain'}
        </Button>
      </div>
      <Hint className="mt-2">
        GOLD sends on your behalf from one address until this domain is verified.
      </Hint>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}
