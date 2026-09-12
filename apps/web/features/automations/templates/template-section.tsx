'use client';

import { DividedList, EmptyState, GroupHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { useActionState } from 'react';
import { PLACEHOLDERS, type MessageDelivery, type MessageTemplate } from '@/lib/domain/automation/templates';
import {
  createTemplateAction,
  deleteTemplateAction,
  updateTemplateAction,
} from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

/**
 * What this business says, and what it has said.
 *
 * **Every word here belongs to the business.** The placeholders are the platform's whole
 * contribution — five names for things it already has — and an unknown one is left exactly as
 * typed rather than blanked, because deleting somebody's sentence is worse than leaving a word
 * they will recognise as their own mistake.
 */
export function MessageTemplateSection({
  organizationId,
  templates,
  deliveries,
  mayManage,
  role,
}: {
  organizationId: string;
  templates: MessageTemplate[];
  deliveries: MessageDelivery[];
  mayManage: boolean;
  role: string;
}) {
  return (
    <Section id="messages" className="mt-10 scroll-mt-6">
      <SectionHeading>What this business says</SectionHeading>
      <Hint className="mt-1 max-w-2xl">
        Every word a customer reads is written here. The platform adds nothing — no greeting, no
        signature, no footer — and puts values where you write{' '}
        {PLACEHOLDERS.map((entry) => entry.token).join(', ')}. A message already sent keeps the
        words it was sent with, so editing one of these changes only what happens next.
      </Hint>
      <Hint className="mt-1 max-w-2xl">
        {/* Whether this installation can actually send on a channel is a fact about the sending
            service rather than about this business, and this screen cannot see it. Rather than
            imply everything works, it says where the answer appears: on the message itself, the
            first time one is attempted. */}
        Whether messages can be sent at all depends on what this installation is connected to.
        Each one below says what happened to it, including when there was nothing to send it
        with.
      </Hint>

      {templates.length === 0 ? (
        <EmptyState className="mt-3">Nothing written yet.</EmptyState>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {templates.map((template) =>
            mayManage ? (
              <EditTemplateForm
                key={template.id}
                organizationId={organizationId}
                template={template}
              />
            ) : (
              <article key={template.id} className="text-sm">
                <p className="font-medium">{template.name}</p>
                {template.subject ? <Hint>{template.subject}</Hint> : null}
                <Hint className="whitespace-pre-wrap">{template.body}</Hint>
              </article>
            ),
          )}
        </div>
      )}

      {mayManage ? (
        <NewTemplateForm organizationId={organizationId} />
      ) : (
        <Hint className="mt-3">
          Your role, {role}, cannot change what this business says.
        </Hint>
      )}

      {deliveries.length > 0 ? (
        <div className="mt-6">
          <GroupHeading>Sent</GroupHeading>
          <DividedList className="mt-1 text-sm">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="text-subtle">
                  {new Date(delivery.queuedAt).toLocaleString('en-GB')}
                </span>
                <span>{delivery.recipient}</span>
                <span className="text-muted">{delivery.ruleName}</span>
                {delivery.state === 'failed' ? (
                  <span className="text-danger">
                    failed — {delivery.detail}
                  </span>
                ) : (
                  <span className="text-subtle">{delivery.state}</span>
                )}
              </li>
            ))}
          </DividedList>
        </div>
      ) : null}
    </Section>
  );
}

function TemplateFields({ template }: { template?: MessageTemplate }) {
  return (
    <>
      <TextInput
        name="name"
        type="text"
        required
        maxLength={120}
        defaultValue={template?.name}
        aria-label="What this message is for"
        placeholder="What this message is for"
        size="small"
      />
      <TextInput
        name="subject"
        type="text"
        maxLength={300}
        defaultValue={template?.subject}
        aria-label="Subject line"
        placeholder="Subject line, for email"
        size="small"
      />
      <TextArea
        name="body"
        required
        maxLength={4000}
        rows={4}
        defaultValue={template?.body}
        aria-label="What it says"
        placeholder="What it says"
        size="small"
        className="w-full"
      />
    </>
  );
}

function NewTemplateForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createTemplateAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex max-w-2xl flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <GroupHeading>New message</GroupHeading>
      <TemplateFields />
      <Button type="submit" disabled={pending} tone="secondary" size="small" className="w-fit">
        {pending ? 'Adding…' : 'Add message'}
      </Button>
      <ActionError state={state} />
    </form>
  );
}

function EditTemplateForm({
  organizationId,
  template,
}: {
  organizationId: string;
  template: MessageTemplate;
}) {
  const [state, formAction, pending] = useActionState(updateTemplateAction, INITIAL);
  const [removeState, removeAction, removing] = useActionState(deleteTemplateAction, INITIAL);

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="templateId" value={template.id} />
        <TemplateFields template={template} />
        <Button type="submit" disabled={pending} tone="secondary" size="small" className="w-fit">
          {pending ? '…' : 'Save'}
        </Button>
        <ActionError state={state} />
      </form>

      <form id={`delete-template-${template.id}`} action={removeAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="templateId" value={template.id} />
        <ConfirmSubmit
          formId={`delete-template-${template.id}`}
          label="remove"
          confirmLabel="Remove message"
          description={`Remove "${template.name}"? Any rule using it loses its action.`}
          tone="text"
          size="tiny"
          pending={removing}
        />
        <ActionError state={removeState} />
      </form>
    </div>
  );
}
