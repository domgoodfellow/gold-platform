'use client';

import { useActionState } from 'react';
import { uploadCustomerDocumentAction, type UploadState } from './actions';

const INITIAL: UploadState = { error: null };

export function UploadDocumentForm({
  organizationId,
  customerId,
}: {
  organizationId: string;
  customerId: string;
}) {
  const [state, formAction, pending] = useActionState(uploadCustomerDocumentAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="customerId" value={customerId} />

      <input
        name="file"
        type="file"
        required
        aria-label="File"
        className="text-sm file:mr-3 file:rounded file:border file:border-black/15 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
      />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Uploading…' : 'Attach document'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
