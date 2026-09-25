'use client';

import { useActionState } from 'react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import type { AccountFormState } from '@/app/organizations/[organizationId]/platform/providers/[providerKey]/action-states';
import { saveProviderAccountAction } from '@/app/organizations/[organizationId]/platform/providers/[providerKey]/actions';

const INITIAL: AccountFormState = { error: null, saved: false };

/**
 * Account label and credential, for a Provider whose whole account model is one API key — no
 * subaccount, no external identifier, no separate credential identifier. `TwilioAccountForm` is
 * the form this generalises; a Provider that ever needs those fields back keeps its own form
 * rather than growing conditionals onto this one.
 *
 * The credential field is write-only, exactly as Twilio's is: empty on an existing account, and
 * leaving it empty on save keeps whatever is already stored.
 */
export function ProviderAccountForm({
  providerKey,
  account,
}: {
  providerKey: string;
  account?: { id: string; label: string; credentialSetAt: string | null };
}) {
  const [state, action, pending] = useActionState(saveProviderAccountAction, INITIAL);

  useEffect(() => {
    if (state.saved) toast.success(account ? 'Account saved.' : 'Account added. Verify it to begin using it.');
  }, [state, account]);

  return (
    <form action={action} className="flex flex-col gap-3" autoComplete="off">
      <input type="hidden" name="providerKey" value={providerKey} />
      {account ? <input type="hidden" name="accountId" value={account.id} /> : null}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="label">Account label</FieldLabel>
        <TextInput id="label" name="label" required maxLength={120} defaultValue={account?.label ?? ''} placeholder="GildOps account" />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="secret">{account?.credentialSetAt ? 'Replace API key' : 'API key'}</FieldLabel>
        <TextInput
          id="secret"
          name="secret"
          type="password"
          autoComplete="new-password"
          required={!account}
          placeholder={account?.credentialSetAt ? 'Stored — leave empty to keep it' : ''}
        />
        <Hint>Stored in the secret store on save. It cannot be read back, by anyone.</Hint>
      </div>
      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? 'Saving…' : account ? 'Save account' : 'Add account'}
      </Button>
    </form>
  );
}
