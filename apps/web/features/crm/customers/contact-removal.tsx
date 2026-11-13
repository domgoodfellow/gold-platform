'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@gold/ui/components/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@gold/ui/components/dialog';
import { Button } from '@/components/controls/button';
import { FormError } from '@/components/controls/form';
import type { ContactRemoval, RetainedRecordKind } from '@/lib/domain/contacts/contacts';
import { archiveContactAction, deleteContactAction, restoreContactAction } from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/removal-actions';

/** What keeps a contact from being deleted, by kind. Never which record: the person may not be able to read it. */
const RETAINED_LABEL: Record<RetainedRecordKind, string> = {
  opportunities: 'Opportunities',
  tasks: 'Tasks, including calls on the call list',
  calls: 'Call history',
  conversations: 'Conversations',
  finance: 'Invoices or proposals',
  work: 'Work or assets',
  support: 'Support cases',
  services: 'Services and notifications',
  portal: 'Customer portal access',
  forms: 'Form responses or inquiries',
  discovery: 'Discovery answers',
  documents: 'Documents',
  locations: 'Locations',
  affiliations: 'Company affiliations',
  imports: 'Import history',
  reports: 'Saved reports',
};

type Step = 'archive' | 'restore' | 'delete';

/**
 * Archive, Restore and Delete permanently for one contact, each confirmed first. Archive keeps the
 * contact and everything that refers to it and takes it out of working lists; Restore brings it
 * back; Delete permanently is only possible when nothing the business must keep refers to it, and
 * otherwise says which kinds of record do and offers Archive. Rendered only for `customer.delete`;
 * the database refuses anyone else.
 */
export function ContactRemovalActions({ organizationId, contactId, name, removal }: {
  organizationId: string; contactId: string; name: string; removal: ContactRemoval;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('archive');
  // Kept apart from `step`, so the dialog keeps its content while it closes.
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blocked = removal.retained.length > 0;
  const open = (next: Step) => { setError(null); setStep(next); setShown(true); };
  const close = () => setShown(false);
  const act = (kind: Step) => startTransition(async () => {
    setError(null);
    const action = kind === 'archive' ? archiveContactAction : kind === 'restore' ? restoreContactAction : deleteContactAction;
    const result = await action(organizationId, contactId);
    if (result.error) { setError(result.error); return; }
    close();
    if (kind === 'delete') {
      toast.success(`Deleted ${name}.`);
      router.push(`/organizations/${organizationId}/crm/contacts`);
      return;
    }
    toast.success(kind === 'archive' ? `Archived ${name}.` : `Restored ${name}.`);
    router.refresh();
  });

  return <>
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" tone="secondary" aria-label={`More actions for ${name}`}><MoreHorizontal aria-hidden /></Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end">
        {removal.archived
          ? <DropdownMenuItem onSelect={() => open('restore')}>Restore contact</DropdownMenuItem>
          : <DropdownMenuItem onSelect={() => open('archive')}>Archive contact</DropdownMenuItem>}
        <DropdownMenuItem variant="destructive" onSelect={() => open('delete')}>Delete permanently</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={shown} onOpenChange={next => { if (!pending && !next) close(); }}>
      <DialogContent role="alertdialog" showCloseButton={false}>
        {step === 'archive' ? <>
          <DialogHeader>
            <DialogTitle>Archive {name}?</DialogTitle>
            <DialogDescription>They leave the contact list, pickers and counts. Their records and history are kept, and you can restore them.</DialogDescription>
          </DialogHeader>
          <FormError>{error}</FormError>
          <DialogFooter>
            <Button type="button" tone="secondary" size="small" disabled={pending} onClick={close}>Cancel</Button>
            <Button type="button" tone="primary" size="small" disabled={pending} onClick={() => act('archive')}>{pending ? 'Archiving…' : 'Archive contact'}</Button>
          </DialogFooter>
        </> : step === 'restore' ? <>
          <DialogHeader>
            <DialogTitle>Restore {name}?</DialogTitle>
            <DialogDescription>They return to the contact list and pickers.</DialogDescription>
          </DialogHeader>
          <FormError>{error}</FormError>
          <DialogFooter>
            <Button type="button" tone="secondary" size="small" disabled={pending} onClick={close}>Cancel</Button>
            <Button type="button" tone="primary" size="small" disabled={pending} onClick={() => act('restore')}>{pending ? 'Restoring…' : 'Restore contact'}</Button>
          </DialogFooter>
        </> : step === 'delete' && blocked ? <>
          <DialogHeader>
            <DialogTitle>{name} can’t be deleted</DialogTitle>
            <DialogDescription>{removal.archived ? 'These records refer to them and must be kept, so they stay archived:' : 'These records refer to them and must be kept. Archive them instead to take them out of working lists:'}</DialogDescription>
          </DialogHeader>
          <ul aria-label="Records that must be kept" className="list-disc pl-5 text-sm">{removal.retained.map(kind => <li key={kind}>{RETAINED_LABEL[kind]}</li>)}</ul>
          <FormError>{error}</FormError>
          <DialogFooter>
            <Button type="button" tone="secondary" size="small" disabled={pending} onClick={close}>Close</Button>
            {removal.archived ? null : <Button type="button" tone="primary" size="small" disabled={pending} onClick={() => act('archive')}>{pending ? 'Archiving…' : 'Archive contact'}</Button>}
          </DialogFooter>
        </> : <>
          <DialogHeader>
            <DialogTitle>Delete {name} permanently?</DialogTitle>
            <DialogDescription>The contact and their details are removed and can’t be restored. The history log keeps a record that they were deleted.</DialogDescription>
          </DialogHeader>
          <FormError>{error}</FormError>
          <DialogFooter>
            <Button type="button" tone="secondary" size="small" disabled={pending} onClick={close}>Cancel</Button>
            <Button type="button" tone="danger" size="small" disabled={pending} onClick={() => act('delete')}>{pending ? 'Deleting…' : 'Delete permanently'}</Button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
