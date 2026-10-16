'use client';
import { useActionState, useEffect, useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormError, FormField } from '@/components/controls/form';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { saveEventAction } from '@/app/organizations/[organizationId]/calendar/actions';
import type { CalendarEvent } from '@/lib/domain/calendar/events';
import type { WorkspaceKey } from '@/lib/navigation';

function localInput(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function EventSheet({ organizationId, workspace, timezone, event, startsAt, mayEdit = true, children, slot = false }: {
  organizationId: string; workspace: WorkspaceKey; timezone: string; event?: CalendarEvent;
  startsAt: string; mayEdit?: boolean; children?: ReactNode; slot?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <PageDrawer open={open} onOpenChange={setOpen}>
    <PageDrawerTrigger asChild><Button tone={event || slot ? 'text' : 'primary'} className={slot ? 'h-full w-full rounded-none p-0 hover:bg-accent/10' : event ? 'h-auto w-full justify-start whitespace-normal p-0 text-left text-inherit' : undefined}>{children ?? 'New event'}</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{event ? mayEdit ? 'Edit event' : 'Event' : 'New event'}</PageDrawerTitle></PageDrawerHeader>
      {open ? <EventForm organizationId={organizationId} workspace={workspace} timezone={timezone} event={event} startsAt={startsAt} mayEdit={mayEdit} close={() => setOpen(false)}/> : null}
    </PageDrawerContent>
  </PageDrawer>;
}
function EventForm({ organizationId, workspace, timezone, event, startsAt, mayEdit, close }: {
  organizationId: string; workspace: WorkspaceKey; timezone: string; event?: CalendarEvent; startsAt: string; mayEdit: boolean; close: () => void;
}) {
  const [state, action, pending] = useActionState(saveEventAction, { error: null, savedId: null });
  const router = useRouter();
  const prefix = useId();
  useEffect(() => { if (state.savedId) { close(); router.refresh(); } }, [state.savedId, close, router]);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="workspace" value={event?.workspace ?? workspace}/><input type="hidden" name="id" value={event?.id ?? ''}/>
    <fieldset disabled={!mayEdit} className="space-y-4">
      <FormField id={`${prefix}-title`} label="Title">{props => <TextInput {...props} name="title" required maxLength={200} defaultValue={event?.title}/>}</FormField>
      <FormField id={`${prefix}-start`} label="Starts" hint={timezone}>{props => <TextInput {...props} name="startsAt" type="datetime-local" required defaultValue={localInput(event?.startsAt ?? startsAt, timezone)}/>}</FormField>
      <FormField id={`${prefix}-end`} label="Ends">{props => <TextInput {...props} name="endsAt" type="datetime-local" required defaultValue={localInput(event?.endsAt ?? new Date(Date.parse(startsAt) + 3600000).toISOString(), timezone)}/>}</FormField>
      <FormField id={`${prefix}-notes`} label="Notes" optional>{props => <textarea {...props} name="notes" rows={4} maxLength={10000} defaultValue={event?.notes ?? ''} className="w-full rounded-md border border-border bg-background p-2"/>}</FormField>
    </fieldset>
    <FormError>{state.error}</FormError>
    {mayEdit ? <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>Save event</Button>{event ? <Button type="submit" tone="danger" name="intent" value="cancel" formNoValidate disabled={pending}>Cancel event</Button> : null}</div> : null}
  </form>;
}
