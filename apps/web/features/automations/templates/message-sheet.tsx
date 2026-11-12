'use client';

import { useActionState, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { TextArea, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  PLACEHOLDERS,
  type MessageTemplate,
} from '@/lib/domain/automation/templates';
import {
  createTemplateAction,
  updateTemplateAction,
} from '@/app/organizations/[organizationId]/automations/actions';
import {
  ActionError,
  INITIAL_AUTOMATION_ACTION_STATE as INITIAL,
} from '../shared';

/**
 * New and Edit share one PageDrawer: a template is small enough that it is the whole editor,
 * never a detail route.
 *
 * **Every word here belongs to the business.** The placeholders are the platform's whole
 * contribution — five names for things it already has — and an unknown one is left exactly as
 * typed rather than blanked.
 */
export function MessageSheet({
  organizationId,
  template,
  label,
}: {
  label?: string;
  organizationId: string;
  /** Absent for New; present for Edit. */
  template?: MessageTemplate;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(template?.body ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const action = template ? updateTemplateAction : createTemplateAction;
  const [state, formAction, pending] = useActionState(
    async (previous: typeof INITIAL, data: FormData) => {
      const result = await action(previous, data);
      if (!result.error) setOpen(false);
      return result;
    },
    INITIAL,
  );
  const samples: Record<string, string> = {
    '{{job}}': 'Sample maintenance visit',
    '{{business}}': 'Sample business',
    '{{customer}}': 'Sample Customer',
    '{{status}}': 'Sample scheduled status',
    '{{when}}': 'Sample: Oct 15, 10:00 AM',
  };
  const preview = (text: string) =>
    PLACEHOLDERS.reduce(
      (value, entry) => value.replaceAll(entry.token, samples[entry.token]),
      text,
    );

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        {template ? (
          <Button
            type="button"
            tone="secondary"
            size="small"
            aria-label={`Edit ${template.name}`}
          >
            <Pencil aria-hidden className="size-4" /> {label ?? 'Edit'}
          </Button>
        ) : (
          <Button type="button" size="small">
            <Plus aria-hidden className="size-4" /> New message
          </Button>
        )}
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>
            {template ? `Edit ${template.name}` : 'New message'}
          </PageDrawerTitle>
          <PageDrawerDescription>
            The platform adds nothing — no greeting, no signature, no footer.
            Write values with{' '}
            {PLACEHOLDERS.map((entry) => entry.token).join(', ')}.
            {template
              ? ' A message already sent keeps the words it was sent with, so this changes only what happens next.'
              : ''}
          </PageDrawerDescription>
        </PageDrawerHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          {template ? (
            <input type="hidden" name="templateId" value={template.id} />
          ) : null}

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
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            aria-label="Subject line"
            placeholder="Subject line, for email"
          />
          <TextArea
            name="body"
            required
            maxLength={4000}
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-label="What it says"
            placeholder="What it says"
          />

          <div>
            <p className="mb-2 text-xs font-medium">
              Insert a supported placeholder
            </p>
            <div className="flex flex-wrap gap-1">
              {PLACEHOLDERS.map((entry) => (
                <Button
                  key={entry.token}
                  type="button"
                  tone="secondary"
                  size="tiny"
                  title={entry.label}
                  onClick={() => setBody((value) => `${value}${entry.token}`)}
                >
                  {entry.token}
                </Button>
              ))}
            </div>
          </div>
          <section className="rounded-lg border border-border p-3">
            <h3 className="text-sm font-semibold">
              Preview · sample values only
            </h3>
            <p className="mt-2 text-xs font-medium">
              {preview(subject) || 'No email subject'}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
              {preview(body) || 'Write a message to preview it here.'}
            </p>
            <p className="mt-3 text-[11px] text-subtle">
              This preview sends nothing and saves no sample values.
            </p>
          </section>


          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Saving…' : template ? 'Save' : 'Add message'}
          </Button>
          <ActionError state={state} />
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
