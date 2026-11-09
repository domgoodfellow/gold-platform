'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { Checkbox } from '@gold/ui/components/checkbox';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import type { CallListCandidate } from '@/lib/application/communications/call-list';
import { addToCallListAction, findCallListContacts } from '@/app/organizations/[organizationId]/calls/call-list-actions';
import { callListAddedMessage } from './add-to-list-menu';

/**
 * The Dialer's Add to list: pick contacts and put them on the call list in one step, without
 * leaving the Dialer. Each becomes an open Call task, due now. Someone already on the list, or
 * with no phone number, cannot be picked. Choices are kept while the search changes.
 */
export function AddToCallList({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" tone="secondary" size="small" onClick={() => setOpen(true)}><UserPlus aria-hidden /> Add to list</Button>
    <GuardedDialog open={open} onOpenChange={setOpen} size="compact" discardDescription="The contacts you chose have not been added.">
      {open ? <Picker organizationId={organizationId} onAdded={() => setOpen(false)} /> : null}
    </GuardedDialog>
  </>;
}

function Picker({ organizationId, onAdded }: { organizationId: string; onAdded: () => void }) {
  const prefix = useId();
  const router = useRouter();
  const close = useGuardedDialogClose();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CallListCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Map<string, string>>(() => new Map());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useGuardedDialogDirty(chosen.size > 0 || reason.trim() !== '');

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void findCallListContacts(organizationId, search)
        .then(result => { if (!active) return; setResults(result.contacts); setError(result.error); })
        .catch(() => { if (active) setError('Contacts could not be loaded. Try again.'); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, search]);

  const toggle = (contact: CallListCandidate, on: boolean) => setChosen(current => {
    const next = new Map(current);
    if (on) next.set(contact.id, contact.name); else next.delete(contact.id);
    return next;
  });
  const add = () => startTransition(async () => {
    setError(null);
    const result = await addToCallListAction(organizationId, { customerIds: [...chosen.keys()] }, reason);
    if (result.error) { setError(result.error); return; }
    toast.success(callListAddedMessage(result));
    onAdded();
    router.refresh();
  });

  return <>
    <StepHeader title="Add to call list" />
    <DialogBody>
      <div className="space-y-4">
        <FormField id={`${prefix}-search`} label="Find contacts">{p => <TextInput {...p} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email or phone" autoComplete="off" />}</FormField>
        {results === null && !error ? <p role="status" className="text-sm text-muted">Loading contacts…</p> : results && results.length === 0 ? (
          <p className="text-sm text-muted">{search.trim() ? 'No contacts match.' : 'No contacts yet.'}</p>
        ) : results ? (
          <ul aria-label="Contacts" className="-mx-2 divide-y divide-border">
            {results.map(contact => {
              const id = `${prefix}-contact-${contact.id}`;
              const blocked = contact.onList || !contact.phone;
              return <li key={contact.id}>
                <label htmlFor={id} className={cx('flex items-center gap-3 rounded-md px-2 py-2', blocked ? 'cursor-default' : 'cursor-pointer hover:bg-hover')}>
                  <Checkbox id={id} checked={contact.onList || chosen.has(contact.id)} disabled={blocked} onCheckedChange={value => toggle(contact, value === true)} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-sm font-medium', blocked && 'text-muted')}>{contact.name}</span>
                    <span className="block truncate text-xs tabular-nums text-muted">{contact.phone ? formatPhoneForDisplay(contact.phone) : 'No phone number'}</span>
                  </span>
                  {contact.onList ? <span className="shrink-0 text-xs text-muted">On the list</span> : null}
                </label>
              </li>;
            })}
          </ul>
        ) : null}
        <FormField id={`${prefix}-reason`} label="Reason" optional>{p => <TextInput {...p} value={reason} onChange={event => setReason(event.target.value)} maxLength={200} placeholder="Call" />}</FormField>
        <FormError>{error}</FormError>
      </div>
    </DialogBody>
    <DialogFooterBar>
      <Button type="button" disabled={!chosen.size || pending} onClick={add}>{pending ? 'Adding…' : chosen.size ? `Add ${chosen.size} to list` : 'Add to list'}</Button>
      <Button type="button" tone="secondary" onClick={close}>Cancel</Button>
    </DialogFooterBar>
  </>;
}
