'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { ErrorText, TextArea, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import type { PublicProfile } from '@/lib/domain/tenancy/profile';

export type ProfileActionState = { error: string | null };

/**
 * The editor for what a business says about itself.
 *
 * Every field is optional and empty means unset, which is why nothing here is `required`: a
 * business that wants only its name on the page is making a choice, not leaving a form
 * half-filled.
 *
 * The action is passed in rather than imported. This component lives in `features/` and is
 * rendered from `/settings`; importing that route's action would tie a feature to one route's
 * file, which is the coupling moving it here was meant to remove.
 */
export function ProfileForm({
  organizationId,
  profile,
  action,
}: {
  organizationId: string;
  profile: PublicProfile;
  action: (
    previous: ProfileActionState,
    formData: FormData,
  ) => Promise<ProfileActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <label className="flex flex-col gap-1 text-sm">
        <span>Name shown to customers</span>
        <TextInput
          name="displayName"
          type="text"
          maxLength={200}
          defaultValue={profile.displayName}
          className="w-full"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Tagline</span>
        <TextInput
          name="tagline"
          type="text"
          maxLength={200}
          defaultValue={profile.tagline ?? ''}
          className="w-full"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>About this business</span>
        <TextArea
          name="intro"
          rows={4}
          maxLength={2000}
          defaultValue={profile.intro ?? ''}
          className="w-full"
        />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>Phone</span>
          <PhoneInput
            name="contactPhone"
            type="tel"
            maxLength={50}
            defaultValue={profile.contactPhone ?? ''}
            className="w-full"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>Email</span>
          <TextInput
            name="contactEmail"
            type="email"
            maxLength={200}
            defaultValue={profile.contactEmail ?? ''}
            className="w-full"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>Address</span>
        <TextInput
          name="address"
          type="text"
          maxLength={500}
          defaultValue={profile.address ?? ''}
          className="w-full"
        />
      </label>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Saving…' : 'Save profile'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
