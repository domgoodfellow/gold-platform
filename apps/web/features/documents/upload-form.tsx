'use client';

import { ErrorText } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, type ComponentProps } from 'react';
import { cx } from '@/components/class-names';

/** `uploaded` names the file a successful upload stored, so a caller that closes on success can tell success from a fresh form. */
export type UploadDocumentState = { error: string | null; uploaded?: string };

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
  submitLabel = 'Attach document',
  className,
}: {
  action: (previous: UploadDocumentState, formData: FormData) => Promise<UploadDocumentState>;
  hiddenFields: Record<string, string>;
  submitLabel?: string;
  /** Placement from whatever holds the form; the form has no outer margin of its own. */
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_UPLOAD_DOCUMENT_STATE);

  return (
    <form action={formAction} className={cx('flex flex-col gap-3', className)}>
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <DocumentFileInput />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Uploading…' : submitLabel}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/** The one file control every document upload uses. */
export function DocumentFileInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type' | 'name'>) {
  return (
    <input
      {...props}
      name="file"
      type="file"
      required
      aria-label={props['aria-label'] ?? 'File'}
      className={cx('text-sm file:mr-3 file:rounded file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20', className)}
    />
  );
}
