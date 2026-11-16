'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@gold/ui/components/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@gold/ui/components/dialog';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import {
  callTaskEditOptions, reassignCallTaskAction, removeFromCallListAction, rescheduleCallTaskAction, scheduleCallbackAction,
} from '@/app/organizations/[organizationId]/calls/call-list-actions';

type EditOptions = Awaited<ReturnType<typeof callTaskEditOptions>>;

/** An instant as a `datetime-local` value in a timezone: what the field shows and sends back. */
export function localDateTime(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const part = (key: string) => parts.find(item => item.type === key)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Loads what a call's time and owner are chosen from, once per opening. */
function useEditOptions(organizationId: string, open: boolean) {
  const [loaded, setLoaded] = useState<{ options: EditOptions | null; error: string | null }>({ options: null, error: null });
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    void callTaskEditOptions(organizationId)
      .then(options => { if (active) setLoaded({ options, error: null }); })
      .catch(() => { if (active) setLoaded({ options: null, error: 'Task options could not be loaded. Close and try again.' }); });
    return () => { active = false; };
  }, [organizationId, open]);
  return loaded;
}

export type CallListEntryTarget = { taskId: string; customerId: string; name: string; dueAt: string; ownerMembershipId: string | null };

/**
 * One call list entry's actions. Each is offered only to a member who may do it, and the server
 * checks again: Reschedule and Reassign change the entry's own open Call task (task permission);
 * Skip sets it aside for this calling session and changes no task; Remove from list asks first,
 * then cancels the open Call task (`call_list.remove`). None of them touches a call in progress.
 */
export function CallListEntryActions({
  organizationId, timezone, entry, mayViewContacts = false, mayManageTasks = false, mayRemove = false, onSkip, onChanged,
}: {
  organizationId: string;
  timezone: string;
  entry: CallListEntryTarget;
  mayViewContacts?: boolean;
  mayManageTasks?: boolean;
  mayRemove?: boolean;
  /** Sets this entry aside for the calling session. */
  onSkip: () => void;
  /** Told after the entry's task changed, so the list is read again. */
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<'reschedule' | 'reassign' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { name, taskId } = entry;
  const open = (next: typeof dialog) => { setError(null); setDialog(next); };
  const run = (action: () => Promise<{ error: string | null }>, done: string) => startTransition(async () => {
    setError(null);
    const result = await action();
    if (result.error) { setError(result.error); return; }
    setDialog(null);
    toast.success(done);
    onChanged();
  });
  const close = (isOpen: boolean) => { if (!pending && !isOpen) setDialog(null); };
  return <>
    <DropdownMenu>
      {/* Its own provider, so the entry works wherever it is drawn; the app's provider is the same component. */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" tone="text" size="tiny" aria-label={`Actions for ${name}`}><MoreHorizontal aria-hidden /></Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Actions</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end">
        {mayViewContacts ? <>
          <DropdownMenuItem asChild><Link href={`/organizations/${organizationId}/crm/contacts/${entry.customerId}`}>Open contact</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href={`/organizations/${organizationId}/crm/tasks?status=open&kind=call&selected=${taskId}`}>Task details</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
        </> : null}
        {mayManageTasks ? <>
          <DropdownMenuItem onSelect={() => open('reschedule')}>Reschedule</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open('reassign')}>Reassign</DropdownMenuItem>
        </> : null}
        <DropdownMenuItem onSelect={onSkip}>Skip for this session</DropdownMenuItem>
        {mayRemove ? <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => open('remove')}>Remove from list</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    {dialog === 'reschedule' ? (
      <RescheduleDialog timezone={timezone} name={name} dueAt={entry.dueAt} error={error} pending={pending} onOpenChange={close}
        onSubmit={dueAt => run(() => rescheduleCallTaskAction(organizationId, taskId, dueAt), `Rescheduled the call to ${name}.`)} />
    ) : null}
    {dialog === 'reassign' ? (
      <ReassignDialog organizationId={organizationId} name={name} ownerMembershipId={entry.ownerMembershipId} error={error} pending={pending} onOpenChange={close}
        onSubmit={owner => run(() => reassignCallTaskAction(organizationId, taskId, owner), owner ? `Reassigned the call to ${name}.` : `The call to ${name} is unassigned.`)} />
    ) : null}
    <Dialog open={dialog === 'remove'} onOpenChange={close}>
      <DialogContent role="alertdialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Remove {name} from the call list?</DialogTitle>
          <DialogDescription>Their open call task is cancelled, and they can be added again later. The contact, their notes and call history are kept, and a call in progress is not ended.</DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        <DialogFooter>
          <Button type="button" tone="secondary" size="small" disabled={pending} onClick={() => setDialog(null)}>Cancel</Button>
          <Button type="button" tone="danger" size="small" disabled={pending} onClick={() => run(() => removeFromCallListAction(organizationId, taskId), `Removed ${name} from the call list.`)}>{pending ? 'Removing…' : 'Remove from list'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function RescheduleDialog({ timezone, name, dueAt, error, pending, onOpenChange, onSubmit }: {
  timezone: string; name: string; dueAt: string; error: string | null; pending: boolean;
  onOpenChange: (open: boolean) => void; onSubmit: (dueAt: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(() => localDateTime(dueAt, timezone));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="contents" onSubmit={event => { event.preventDefault(); if (value) onSubmit(value); }}>
          <DialogHeader><DialogTitle>Reschedule the call to {name}</DialogTitle></DialogHeader>
          <FormField id={`${id}-due`} label="Due" hint={timezone}>{props => <TextInput {...props} type="datetime-local" required value={value} onChange={event => setValue(event.target.value)} />}</FormField>
          <FormError>{error}</FormError>
          <DialogFooter>
            <Button type="button" tone="secondary" size="small" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="small" disabled={pending || !value}>{pending ? 'Saving…' : 'Reschedule'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDialog({ organizationId, name, ownerMembershipId, error, pending, onOpenChange, onSubmit }: {
  organizationId: string; name: string; ownerMembershipId: string | null; error: string | null; pending: boolean;
  onOpenChange: (open: boolean) => void; onSubmit: (ownerMembershipId: string) => void;
}) {
  const id = useId();
  const [owner, setOwner] = useState(ownerMembershipId ?? '');
  const { options, error: loadError } = useEditOptions(organizationId, true);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="contents" onSubmit={event => { event.preventDefault(); if (options) onSubmit(owner); }}>
          <DialogHeader><DialogTitle>Reassign the call to {name}</DialogTitle></DialogHeader>
          {options ? (
            <FormField id={`${id}-owner`} label="Owner">{props => <SelectField {...props} value={owner} onValueChange={setOwner} options={[{ value: '', label: 'Unassigned' }, ...options.members.map(member => ({ value: member.id, label: member.name }))]} />}</FormField>
          ) : loadError ? null : <p role="status" className="text-sm text-muted">Loading members…</p>}
          <FormError>{error ?? loadError}</FormError>
          <DialogFooter>
            <Button type="button" tone="secondary" size="small" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="small" disabled={pending || !options}>{pending ? 'Saving…' : 'Reassign'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Schedule the callback a call ended with. The contact's one open Call task moves to the chosen
 * time; when they have none, the reason for the new one is asked for, never invented.
 */
export function ScheduleCallback({ organizationId, timezone, callId, name, hasOpenTask, onScheduled }: {
  organizationId: string; timezone: string; callId: string; name: string;
  /** Whether the contact already has an open Call task to move. */
  hasOpenTask: boolean;
  onScheduled: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { options, error: loadError } = useEditOptions(organizationId, open);
  const due = value || options?.dueAt || '';
  const submit = () => startTransition(async () => {
    setError(null);
    const result = await scheduleCallbackAction(organizationId, callId, due, hasOpenTask ? undefined : reason);
    if (result.error) { setError(result.error); return; }
    setOpen(false);
    toast.success(`Callback scheduled for ${name}.`);
    onScheduled();
  });
  return <>
    <Button type="button" tone="secondary" onClick={() => { setError(null); setOpen(true); }}>Schedule callback</Button>
    <Dialog open={open} onOpenChange={next => { if (!pending) setOpen(next); }}>
      <DialogContent>
        <form className="contents" onSubmit={event => { event.preventDefault(); if (due) submit(); }}>
          <DialogHeader><DialogTitle>Schedule a callback for {name}</DialogTitle></DialogHeader>
          <FormField id={`${id}-due`} label="Call back" hint={options?.timezone ?? timezone}>{props => <TextInput {...props} type="datetime-local" required value={due} onChange={event => setValue(event.target.value)} />}</FormField>
          {hasOpenTask ? null : (
            <FormField id={`${id}-reason`} label="Reason for calling">{props => <TextInput {...props} required maxLength={200} value={reason} onChange={event => setReason(event.target.value)} />}</FormField>
          )}
          <FormError>{error ?? loadError}</FormError>
          <DialogFooter>
            <Button type="button" tone="secondary" size="small" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="small" disabled={pending || !due || (!hasOpenTask && !reason.trim())}>{pending ? 'Saving…' : 'Schedule callback'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
