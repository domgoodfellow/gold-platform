'use client';

import { ErrorText } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
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
        className="text-sm file:mr-3 file:rounded file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
      />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Uploading…' : 'Attach document'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
