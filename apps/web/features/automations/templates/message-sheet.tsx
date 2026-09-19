'use client';

import { useActionState, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Hint, TextArea, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/containers/page-drawer';
import { PLACEHOLDERS, type MessageTemplate } from '@/lib/domain/automation/templates';
import {
  createTemplateAction,
  updateTemplateAction,
} from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

/**
 * New and Edit share one PageDrawer, the same shape `EditRoleSheet` uses for roles — a template is
 * small enough that a PageDrawer is the whole editor, never a detail route.
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
  const [open, setOpen] = useState(false);
  const action = template ? updateTemplateAction : createTemplateAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        {template ? (
          <Button type="button" tone="secondary" size="small" aria-label={`Edit ${template.name}`}>
            <Pencil aria-hidden className="size-4" /> Edit
          </Button>
        ) : (
          <Button type="button" size="small">
            <Plus aria-hidden className="size-4" /> New message
          </Button>
        )}
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{template ? `Edit ${template.name}` : 'New message'}</PageDrawerTitle>
          <PageDrawerDescription>
            The platform adds nothing — no greeting, no signature, no footer. Write values with{' '}
            {PLACEHOLDERS.map((entry) => entry.token).join(', ')}.
            {template
              ? ' A message already sent keeps the words it was sent with, so this changes only what happens next.'
              : ''}
          </PageDrawerDescription>
        </PageDrawerHeader>

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
      </PageDrawerContent>
    </PageDrawer>
  );
}
