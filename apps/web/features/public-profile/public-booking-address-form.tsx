'use client';

import { useActionState } from 'react';
import {
  updatePublicBookingAddressAction,
  type SettingsActionState,
} from '@/app/organizations/[organizationId]/settings/actions';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';

const INITIAL: SettingsActionState = { error: null };

export function PublicBookingAddressForm({
  organizationId,
  slug,
  hasBookableType,
}: {
  organizationId: string;
  slug: string | null;
  hasBookableType: boolean;
}) {
  const [state, formAction, pending] = useActionState(updatePublicBookingAddressAction, INITIAL);

  return (
    <div className="mt-4 flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <FormField
          id="public-booking-address"
          label="Public booking address"
          optional
          hint="Customers book at /book/<address>. Leave it empty to disable the public address. Changing it breaks links already shared."
        >
          {(field) => (
            <TextInput
              {...field}
              name="slug"
              type="text"
              maxLength={63}
              pattern="[a-z0-9][a-z0-9-]{1,62}"
              defaultValue={slug ?? ''}
              placeholder="gildops"
            />
          )}
        </FormField>
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? 'Saving…' : 'Save address'}
        </Button>
        <ErrorText role="alert">{state.error}</ErrorText>
      </form>

      {slug && hasBookableType ? (
        <ButtonLink href={`/book/${slug}`} target="_blank" size="small" className="w-fit">
          Preview /book/{slug}
        </ButtonLink>
      ) : (
        <Hint className="text-xs">
          {slug
            ? 'Not reachable yet — publish at least one bookable kind of work first.'
            : 'No public booking address is configured.'}
        </Hint>
      )}
    </div>
  );
}
