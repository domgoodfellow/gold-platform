'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DocumentFileInput, INITIAL_UPLOAD_DOCUMENT_STATE, type UploadDocumentState } from './upload-form';

type UploadAction = (previous: UploadDocumentState, formData: FormData) => Promise<UploadDocumentState>;

/**
 * Uploading one document as a contextual action: a trigger that opens a focused dialog with the same
 * file control and the same server action as the inline upload form. A chosen file is unsaved input,
 * so closing asks first; a refusal stays in the dialog beside the file; a stored file closes it, is
 * confirmed with a toast, and the page re-reads its collection.
 */
export function DocumentUploadDialog({ action, hiddenFields, title = 'Upload a file', triggerLabel = 'Upload' }: {
  action: UploadAction;
  hiddenFields: Record<string, string>;
  title?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return <>
    <Button type="button" size="small" onClick={() => { setKey(value => value + 1); setOpen(true); }}><Upload aria-hidden />{triggerLabel}</Button>
    <GuardedDialog open={open} onOpenChange={setOpen} size="compact" discardDescription="The file you chose has not been uploaded.">
      <UploadStep key={key} action={action} hiddenFields={hiddenFields} title={title} onUploaded={() => setOpen(false)} />
    </GuardedDialog>
  </>;
}

function UploadStep({ action, hiddenFields, title, onUploaded }: { action: UploadAction; hiddenFields: Record<string, string>; title: string; onUploaded: () => void }) {
  const [state, formAction, pending] = useActionState(action, INITIAL_UPLOAD_DOCUMENT_STATE);
  const [chosen, setChosen] = useState(false);
  const id = useId();
  const router = useRouter();
  const cancel = useGuardedDialogClose();
  useGuardedDialogDirty(chosen && !state.uploaded);
  // Each stored upload is confirmed once, however often the dialog re-renders after it.
  const confirmed = useRef<UploadDocumentState | null>(null);
  useEffect(() => {
    if (!state.uploaded || confirmed.current === state) return;
    confirmed.current = state;
    toast.success(`Uploaded ${state.uploaded}`);
    onUploaded();
    router.refresh();
  }, [state, onUploaded, router]);
  return <>
    <StepHeader title={title} />
    <DialogBody>
      <form id={id} action={formAction} className="flex flex-col gap-3">
        {Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <DocumentFileInput onChange={event => setChosen(Boolean(event.currentTarget.files?.length))} />
        <ErrorText role="alert">{state.error}</ErrorText>
      </form>
    </DialogBody>
    <DialogFooterBar>
      <Button type="submit" form={id} disabled={pending || !chosen}>{pending ? 'Uploading…' : 'Upload'}</Button>
      <Button type="button" tone="secondary" onClick={cancel}>Cancel</Button>
    </DialogFooterBar>
  </>;
}
