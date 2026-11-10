'use client';

import { useEffect, useId, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ListPlus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { Button, type ButtonSize } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import type { CallListTarget, CallListTaskDraft } from '@/lib/application/communications/call-list';
import { addToCallListAction, previewAddToCallList, type AddToCallListResult, type CallListPreview } from '@/app/organizations/[organizationId]/calls/call-list-actions';
import { CallListTaskFields } from './call-list-task-fields';

const people = (count: number) => `${count} ${count === 1 ? 'contact' : 'contacts'}`;

/** The toast after an add: who was added, and who was skipped and why. */
export function callListAddedMessage({ added, alreadyOnList, noPhone }: Pick<AddToCallListResult, 'added' | 'alreadyOnList' | 'noPhone'>): string {
  const skipped = [alreadyOnList ? `${people(alreadyOnList)} already on it` : '', noPhone ? `${people(noPhone)} with no phone number` : ''].filter(Boolean).join(', ');
  if (!added) return skipped ? `No one added: ${skipped}.` : 'No one added.';
  return `Added ${people(added)} to the call list.${skipped ? ` Skipped ${skipped}.` : ''}`;
}

/** One contact's standing on the call list, decided on the server. */
export type CallListStanding = 'ready' | 'on-list' | 'no-phone';

/**
 * Add to…: the lists a contact can be put on. Today that is the Dialer's call list; the page only
 * renders this when the business has the Dialer and the member may manage tasks.
 *
 * Every entry opens the same task-details dialog, with a current preview of additions and skips.
 */
export function AddToListMenu({ organizationId, target, standing, size, onAdded }: {
  organizationId: string;
  target: CallListTarget;
  standing?: CallListStanding;
  size?: ButtonSize;
  /** After a successful add, such as clearing a selection. */
  onAdded?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const note = standing === 'on-list' ? 'On the list' : standing === 'no-phone' ? 'No phone number' : null;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" tone="secondary" size={size}><ListPlus aria-hidden /> Add to…</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem disabled={Boolean(note)} onSelect={() => setConfirming(true)} className="justify-between gap-4">
          <span>Call list</span>{note ? <span className="text-xs text-muted">{note}</span> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
      <GuardedDialog open={confirming} onOpenChange={setConfirming} size="compact" discardDescription="No one has been added yet.">
        {confirming ? <ConfirmAdd organizationId={organizationId} target={target} onAdded={() => { setConfirming(false); onAdded?.(); router.refresh(); }} /> : null}
      </GuardedDialog>
  </>;
}

function ConfirmAdd({ organizationId, target: given, onAdded }: { organizationId: string; target: CallListTarget; onAdded: () => void }) {
  const prefix = useId();
  // Checked once per target, not again whenever the page redraws with an equal target.
  const targetKey = JSON.stringify(given);
  const target = useMemo(() => JSON.parse(targetKey) as CallListTarget, [targetKey]);
  const close = useGuardedDialogClose();
  const [preview, setPreview] = useState<CallListPreview | null>(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState<CallListTaskDraft>({ dueAt: '', ownerMembershipId: '', notes: '' });
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useGuardedDialogDirty(reason.trim() !== '' || detailsDirty);

  useEffect(() => {
    let active = true;
    void previewAddToCallList(organizationId, target)
      .then(result => { if (active) { setPreview(result); setError(result.error); } })
      .catch(() => { if (active) setError('Could not check these contacts. Close and try again.'); });
    return () => { active = false; };
  }, [organizationId, target]);

  const add = () => startTransition(async () => {
    setError(null);
    const result = await addToCallListAction(organizationId, target, reason, details);
    if (result.error) { setError(result.error); return; }
    toast.success(callListAddedMessage(result));
    onAdded();
  });
  const toAdd = preview && !preview.error ? preview.toAdd : 0;
  const skipped = preview && !preview.error ? [
    preview.alreadyOnList ? `${people(preview.alreadyOnList)} already on the list` : '',
    preview.noPhone ? `${people(preview.noPhone)} with no phone number` : '',
  ].filter(Boolean) : [];

  return <>
    <StepHeader title="Add to call list" />
    <DialogBody>
      <div className="space-y-4">
        {!preview && !error ? <p role="status" className="text-sm text-muted">Checking contacts…</p> : null}
        {preview && !preview.error ? <div className="space-y-1 text-sm">
          {'view' in target ? <p className="text-muted">{people(preview.matching)} in the current search and filters.</p> : null}
          <p className="font-medium">{toAdd ? `${people(toAdd)} will be added.` : 'No one here can be added.'}</p>
          {skipped.length ? <p className="text-muted">Skipped: {skipped.join(', ')}.</p> : null}
        </div> : null}
        {toAdd ? <FormField id={`${prefix}-reason`} label="Reason" optional>{p => <TextInput {...p} value={reason} onChange={event => setReason(event.target.value)} maxLength={200} placeholder="Call" />}</FormField> : null}
        {toAdd ? <div onChange={() => setDetailsDirty(true)}><CallListTaskFields organizationId={organizationId} value={details} onChange={setDetails} onDirty={() => setDetailsDirty(true)} /></div> : null}
        <FormError>{error}</FormError>
      </div>
    </DialogBody>
    <DialogFooterBar>
      <Button type="button" disabled={!toAdd || pending || !details.dueAt} onClick={add}>{pending ? 'Adding…' : toAdd ? `Add ${toAdd}` : 'Add'}</Button>
      <Button type="button" tone="secondary" onClick={close}>Cancel</Button>
    </DialogFooterBar>
  </>;
}
