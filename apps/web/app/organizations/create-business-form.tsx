'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { SuggestionField } from '@/components/controls/select-field';
import { BusinessLocationFields } from '@/features/locale/location-fields';
import { INDUSTRY_SUGGESTIONS } from '@/lib/domain/tenancy/industries';
import { createBusinessAction, type CreateBusinessState } from './actions';

const INITIAL: CreateBusinessState = { error: null };

/**
 * Account identity is collected at signup; this screen creates the business with the three things
 * worth knowing on day one — what it is called, where it is, and roughly what it does. The clock
 * and currency are worked out from the location and shown for confirmation, so nobody has to know
 * what an IANA zone is. Street address and the rest are completed later in Settings.
 */
export function CreateBusinessForm() {
  const [state, formAction, pending] = useActionState(createBusinessAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-6">
      <FormField id="business-name" label="What is the business called?">
        {(field) => <TextInput {...field} name="name" type="text" required maxLength={200} autoFocus className="w-full" />}
      </FormField>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Where is it based?</legend>
        <BusinessLocationFields mode="create" />
      </fieldset>

      <FormField id="business-industry" label="What kind of business is it?" optional>
        {(field) => <SuggestionField {...field} name="industry" type="text" maxLength={100} suggestions={INDUSTRY_SUGGESTIONS} className="w-full" />}
      </FormField>

      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={pending} className="w-full sm:w-fit">
          {pending ? 'Creating…' : 'Create business'}
        </Button>
        <ErrorText role="alert">{state.error}</ErrorText>
      </div>
    </form>
  );
}
