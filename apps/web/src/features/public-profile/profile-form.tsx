'use client';

import { useActionState } from 'react';
import type { PublicProfile } from '@/lib/domain/tenancy/profile';

export type ProfileActionState = { error: string | null };

const INPUT_CLASS = 'w-full rounded border border-black/15 px-3 py-2 dark:border-white/20';

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
  slug,
  action,
}: {
  organizationId: string;
  profile: PublicProfile;
  slug: string | null;
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
        <input
          name="displayName"
          type="text"
          maxLength={200}
          defaultValue={profile.displayName}
          className={INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Tagline</span>
        <input
          name="tagline"
          type="text"
          maxLength={200}
          defaultValue={profile.tagline ?? ''}
          className={INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>About this business</span>
        <textarea
          name="intro"
          rows={4}
          maxLength={2000}
          defaultValue={profile.intro ?? ''}
          className={INPUT_CLASS}
        />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>Phone</span>
          <input
            name="contactPhone"
            type="tel"
            maxLength={50}
            defaultValue={profile.contactPhone ?? ''}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>Email</span>
          <input
            name="contactEmail"
            type="email"
            maxLength={200}
            defaultValue={profile.contactEmail ?? ''}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>Address</span>
        <input
          name="address"
          type="text"
          maxLength={500}
          defaultValue={profile.address ?? ''}
          className={INPUT_CLASS}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>

      {/* Where it appears, or that it does not yet. A business with no public address has
          written copy nobody can reach, and saying so is worth more than hiding the form. */}
      <p className="text-xs opacity-70">
        {slug
          ? `Shown at /book/${slug}`
          : 'Set a public booking address above to give this page somewhere to live.'}
      </p>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
