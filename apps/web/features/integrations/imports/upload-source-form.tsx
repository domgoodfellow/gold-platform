'use client';

import { useActionState } from 'react';
import { acceptFor } from '@/lib/domain/files/formats';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  uploadSourceAction,
  type UploadState,
} from '@/app/organizations/[organizationId]/integrations/imports/new/actions';

const UPLOAD_INITIAL: UploadState = { error: null };

export function UploadSourceForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(uploadSourceAction, UPLOAD_INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input
        name="file"
        type="file"
        accept={acceptFor('crm_import')}
        required
        aria-label="CSV file"
        className="text-sm file:mr-3 file:rounded file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Reading file…' : 'Continue'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
