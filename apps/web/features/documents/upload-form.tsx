'use client';

import { ErrorText } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';

export type UploadDocumentState = { error: string | null };

export const INITIAL_UPLOAD_DOCUMENT_STATE: UploadDocumentState = { error: null };

/**
 * One upload control, reused across every entity documents can attach to.
 *
 * The entity being attached to travels as `hiddenFields` rather than a typed prop, because the
 * form itself does not decide what it is attached to — the route's own server action does, by
 * calling `uploadDocument` with the entity that action already knows it owns.
 */
export function DocumentUploadForm({
  action,
  hiddenFields,
}: {
  action: (previous: UploadDocumentState, formData: FormData) => Promise<UploadDocumentState>;
  hiddenFields: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_UPLOAD_DOCUMENT_STATE);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <input
        name="file"
        type="file"
        required
        aria-label="File"
        className="text-sm file:mr-3 file:rounded file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
      />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Uploading…' : 'Attach document'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
