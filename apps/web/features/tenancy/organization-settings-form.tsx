'use client';

import { ErrorText, TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { Button } from '@/components/controls/button';
import { useActionState, useState } from 'react';
import { CurrencyField, TimeZoneField } from '@/features/locale/locale-fields';
import { updateOrganizationGeneralAction, type SettingsActionState } from '@/app/organizations/[organizationId]/settings/actions';

const INITIAL: SettingsActionState & { saved: boolean } = { error: null, saved: false };

export function OrganizationSettingsForm({
  organizationId,
  name,
  timezone,
  currency,
}: {
  organizationId: string;
  name: string;
  timezone: string;
  /** Null when this business has not said yet — signing up no longer asks. */
  currency: string | null;
}) {
  const [dirty, setDirty] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: typeof INITIAL, data: FormData) => {
    const result = await updateOrganizationGeneralAction(previous, data);
    if (!result.error) setDirty(false);
    return { ...result, saved: !result.error };
  }, INITIAL);

  return (
    <form action={formAction} onChange={() => setDirty(true)} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <FormField id="org-name" label="Organization name" className="flex-1">
          {(field) => (
            <TextInput {...field} name="name" type="text" required maxLength={200} defaultValue={name} />
          )}
        </FormField>
      </div>

      {/* The same two controls the founding form uses, so there is one answer to "how does a
          business say where it is" rather than a picker in one place and a text box in the
          other. Whatever they offer, the database still checks the zone against
          `pg_timezone_names` — a list in the application is never the authority. */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <TimeZoneField defaultValue={timezone} />
        <CurrencyField defaultValue={currency ?? undefined} />
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Saving…' : 'Save'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
      {state.saved && !dirty ? <p role="status" className="text-sm text-muted">Business information saved.</p> : null}
    </form>
  );
}
