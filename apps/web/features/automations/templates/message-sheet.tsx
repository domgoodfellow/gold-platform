'use client';

import { useActionState, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Hint, TextArea, TextInput } from '@/components/controls/inputs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import { PLACEHOLDERS, type MessageTemplate } from '@/lib/domain/automation/templates';
import {
  createTemplateAction,
  updateTemplateAction,
} from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

/**
 * New and Edit share one Sheet, the same shape `EditRoleSheet` uses for roles — a template is
 * small enough that a Sheet is the whole editor, never a detail route.
 *
 * **Every word here belongs to the business.** The placeholders are the platform's whole
 * contribution — five names for things it already has — and an unknown one is left exactly as
 * typed rather than blanked (I24).
 */
export function MessageSheet({
  organizationId,
  template,
}: {
  organizationId: string;
  /** Absent for New; present for Edit. */
  template?: MessageTemplate;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const action = template ? updateTemplateAction : createTemplateAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {template ? (
          <Button type="button" tone="secondary" size="small" aria-label={`Edit ${template.name}`}>
            <Pencil aria-hidden className="size-4" /> Edit
          </Button>
        ) : (
          <Button type="button" size="small">
            <Plus aria-hidden className="size-4" /> New message
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{template ? `Edit ${template.name}` : 'New message'}</SheetTitle>
          <SheetDescription>
            The platform adds nothing — no greeting, no signature, no footer. Write values with{' '}
            {PLACEHOLDERS.map((entry) => entry.token).join(', ')}.
            {template
              ? ' A message already sent keeps the words it was sent with, so this changes only what happens next.'
              : ''}
          </SheetDescription>
        </SheetHeader>

        <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          {template ? <input type="hidden" name="templateId" value={template.id} /> : null}

          <TextInput
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={template?.name}
            aria-label="What this message is for"
            placeholder="What this message is for"
          />
          <TextInput
            name="subject"
            type="text"
            maxLength={300}
            defaultValue={template?.subject}
            aria-label="Subject line"
            placeholder="Subject line, for email"
          />
          <TextArea
            name="body"
            required
            maxLength={4000}
            rows={6}
            defaultValue={template?.body}
            aria-label="What it says"
            placeholder="What it says"
          />

          <Hint>
            Whether messages can be sent at all depends on what this installation is connected to
            — each delivery says what happened to it, in Activity.
          </Hint>

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Saving…' : template ? 'Save' : 'Add message'}
          </Button>
          <ActionError state={state} />
        </form>
      </SheetContent>
    </Sheet>
  );
}
