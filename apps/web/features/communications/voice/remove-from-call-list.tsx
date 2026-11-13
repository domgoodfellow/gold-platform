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
import { removeFromCallListAction } from '@/app/organizations/[organizationId]/calls/call-list-actions';

/**
 * One call list entry's actions. Remove from list asks first, then cancels the entry's open Call
 * task. The contact, their history and any call already in progress are left as they are; the
 * Dialer page only renders this for a member who holds `call_list.remove`, and the database
 * refuses anyone else.
 */
export function CallListEntryActions({ organizationId, taskId, name }: { organizationId: string; taskId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const remove = () => startTransition(async () => {
    setError(null);
    const result = await removeFromCallListAction(organizationId, taskId);
    if (result.error) { setError(result.error); return; }
    setConfirming(false);
    toast.success(`Removed ${name} from the call list.`);
    router.refresh();
  });
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
        <DropdownMenuItem onSelect={() => { setError(null); setConfirming(true); }}>Remove from list</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={confirming} onOpenChange={open => { if (!pending) setConfirming(open); }}>
      <DialogContent role="alertdialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Remove {name} from the call list?</DialogTitle>
          <DialogDescription>Their open call task is cancelled, and they can be added again later. The contact, their notes and call history are kept, and a call in progress is not ended.</DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        <DialogFooter>
          <Button type="button" tone="secondary" size="small" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
          <Button type="button" tone="danger" size="small" disabled={pending} onClick={remove}>{pending ? 'Removing…' : 'Remove from list'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
