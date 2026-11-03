'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { CONTACT_TOPICS, PUBLIC_INTAKE_LIMITS } from '@/lib/domain/public-intake/limits';
import { SelectField } from '@/components/controls/select-field';

export type ContactState = { error: string | null; done: boolean };

const INITIAL: ContactState = { error: null, done: false };

/** A general inquiry, not a demo request: no business is required and nothing here is a sales qualifier. */
export function ContactForm({
  action,
}: {
  action: (state: ContactState, formData: FormData) => Promise<ContactState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (state.done) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Message sent</h2>
        <p className="max-w-md text-muted">Thanks. We&rsquo;ve received your message and will reply by email.</p>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">Return home</Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <TextInput id="name" name="name" type="text" required maxLength={PUBLIC_INTAKE_LIMITS.name} autoComplete="name" />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <TextInput id="email" name="email" type="email" required maxLength={PUBLIC_INTAKE_LIMITS.email} autoComplete="email" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="businessName">Business / organization (optional)</FieldLabel>
          <TextInput id="businessName" name="businessName" type="text" maxLength={PUBLIC_INTAKE_LIMITS.businessName} autoComplete="organization" />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="topic">Topic</FieldLabel>
          <SelectField id="topic" name="topic" defaultValue="General question" options={[...CONTACT_TOPICS.map((topic) => ({ value: topic, label: topic }))]} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="message">Message</FieldLabel>
        <TextArea id="message" name="message" rows={6} required maxLength={PUBLIC_INTAKE_LIMITS.context} />
      </div>

      <Hint weight="subtle">
        We use these details to reply to this message and keep it with the record of who wrote.
        Submitting this form does not opt you into marketing messages.
      </Hint>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Sending…' : 'Send message'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
