'use client';

import { useActionState, useEffect, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { FormActions, FormField } from '@/components/controls/form';
import { ErrorText, TextArea, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  createSecretAction,
  replaceSecretAction,
  type SecretFormState,
} from '@/app/organizations/[organizationId]/settings/secrets/actions';
import { SECRET_VALUE_MAX, type SecretReference } from '@/lib/domain/secrets/secret-references';

const INITIAL: SecretFormState = { error: null };

type SheetProps = { organizationId: string } & ({ mode: 'create' } | { mode: 'replace'; reference: SecretReference });

/**
 * Add a credential, or replace the value of one that is stored.
 *
 * **The value field always starts empty and the form never shows what is stored** — there is
 * nothing to show, because nothing in this runtime can read it. A password-typed input and
 * `autoComplete="new-password"` keep a browser from offering to remember it. Replacing may also
 * reword the label and purpose, which are not secret.
 */
export function SecretSheet(props: SheetProps) {
  const [open, setOpen] = useState(false);
  const replacing = props.mode === 'replace';

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        {props.mode === 'replace' ? (
          <Button type="button" tone="secondary" size="small">
            <RefreshCw aria-hidden /> Replace
          </Button>
        ) : (
          <Button type="button">
            <KeyRound aria-hidden /> Add credential
          </Button>
        )}
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{props.mode === 'replace' ? `Replace ${props.reference.key}` : 'Add a credential'}</PageDrawerTitle>
          <PageDrawerDescription>
            {replacing
              ? 'The new value takes the place of the stored one. The old value cannot be recovered.'
              : 'GildOps stores the value encrypted and can use it, but never shows it again — not to you, and not to GildOps staff.'}
          </PageDrawerDescription>
        </PageDrawerHeader>
        <div>
          <SecretForm {...props} onSaved={() => setOpen(false)} />
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}

function SecretForm(props: SheetProps & { onSaved: () => void }) {
  const reference = props.mode === 'replace' ? props.reference : null;
  const [state, formAction, pending] = useActionState(reference ? replaceSecretAction : createSecretAction, INITIAL);
  const { onSaved } = props;

  useEffect(() => {
    if (state.saved) onSaved();
  }, [state, onSaved]);

  const id = reference ? `secret-${reference.id}` : 'secret-new';
  // What was typed survives a refusal; the value never does.
  const draft = state.draft;

  return (
    <form action={formAction} className="flex flex-col gap-4" autoComplete="off">
      <input type="hidden" name="organizationId" value={props.organizationId} />
      {reference ? <input type="hidden" name="secretId" value={reference.id} /> : null}

      {reference ? null : (
        <FormField id={`${id}-key`} label="Name" hint="Capital letters, digits and underscores — the name something will ask for.">
          {(field) => (
            <TextInput
              {...field}
              name="key"
              required
              maxLength={64}
              placeholder="PARTNER_API_KEY"
              defaultValue={draft?.key ?? ''}
              spellCheck={false}
              autoCapitalize="characters"
              className="font-mono"
            />
          )}
        </FormField>
      )}

      <FormField id={`${id}-label`} label="Label">
        {(field) => <TextInput {...field} name="label" required maxLength={80} defaultValue={draft?.label ?? reference?.label ?? ''} />}
      </FormField>

      <FormField id={`${id}-purpose`} label="What it is for" optional>
        {(field) => <TextArea {...field} name="purpose" maxLength={300} rows={2} defaultValue={draft?.purpose ?? reference?.purpose ?? ''} />}
      </FormField>

      <FormField id={`${id}-value`} label={reference ? 'New value' : 'Value'}>
        {(field) => (
          <TextInput
            {...field}
            name="value"
            type="password"
            required
            maxLength={SECRET_VALUE_MAX}
            autoComplete="new-password"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </FormField>

      <ErrorText role="alert">{state.error}</ErrorText>
      <FormActions>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : reference ? 'Replace value' : 'Store credential'}
        </Button>
      </FormActions>
    </form>
  );
}
