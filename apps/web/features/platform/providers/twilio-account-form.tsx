'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { saveTelephonyAccountAction } from '@/app/platform/providers/twilio/actions';
import { ACCOUNT_FORM_INITIAL } from '@/app/platform/providers/twilio/action-states';
import type { TelephonyCredentialKind } from '@/lib/adapters/telephony';

/**
 * Account identity and credential, one form. The credential field is write-only: on an existing
 * account it is empty and says a value is stored, and leaving it empty keeps that value.
 */
export function TwilioAccountForm({
  kinds,
  account,
}: {
  kinds: readonly TelephonyCredentialKind[];
  account?: {
    id: string;
    label: string;
    externalAccountId: string | null;
    credentialKind: string;
    credentialIdentifier: string | null;
    credentialSetAt: string | null;
  };
}) {
  const [state, action, pending] = useActionState(saveTelephonyAccountAction, ACCOUNT_FORM_INITIAL);
  const [kind, setKind] = useState(account?.credentialKind ?? kinds[0]?.key ?? '');
  const selected = kinds.find((candidate) => candidate.key === kind);

  useEffect(() => {
    if (state.saved) toast.success(account ? 'Account saved.' : 'Account added. Verify it to begin provisioning.');
  }, [state, account]);

  return (
    <form action={action} className="flex flex-col gap-3" autoComplete="off">
      {account ? <input type="hidden" name="accountId" value={account.id} /> : null}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="label">Account label</FieldLabel>
        <TextInput id="label" name="label" required maxLength={120} defaultValue={account?.label ?? ''} />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="externalAccountId">Account SID</FieldLabel>
        <TextInput id="externalAccountId" name="externalAccountId" required defaultValue={account?.externalAccountId ?? ''} placeholder="AC…" spellCheck={false} />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="credentialKind">Credential type</FieldLabel>
        <SelectInput id="credentialKind" name="credentialKind" value={kind} onChange={(event) => setKind(event.target.value)}>
          {kinds.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </SelectInput>
      </div>
      {selected?.identifierLabel ? (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="credentialIdentifier">{selected.identifierLabel}</FieldLabel>
          <TextInput id="credentialIdentifier" name="credentialIdentifier" required defaultValue={account?.credentialIdentifier ?? ''} placeholder="SK…" spellCheck={false} />
        </div>
      ) : (
        <input type="hidden" name="credentialIdentifier" value="" />
      )}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="secret">{account?.credentialSetAt ? 'Replace credential' : 'Credential'}</FieldLabel>
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
      <Button type="submit" className="w-fit" disabled={pending}>{pending ? 'Saving…' : account ? 'Save account' : 'Add account'}</Button>
    </form>
  );
}
