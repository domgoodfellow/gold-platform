'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { FOCUS_RING, cx } from '@/components/class-names';

export type WorkflowReviewState = { error: string | null; done: boolean };

const INITIAL: WorkflowReviewState = { error: null, done: false };

/**
 * The one form this route has. A single page rather than a wizard, because a workflow review is
 * a request to talk, not the start of Business Setup — nothing here creates an account, a
 * membership, or an organization (`lib/domain/workflow-review/workflow-review.ts`).
 */
export function WorkflowReviewForm({
  action,
}: {
  action: (state: WorkflowReviewState, formData: FormData) => Promise<WorkflowReviewState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (state.done) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Request received</h2>
        <p className="max-w-md text-muted">
          Someone from GOLD will follow up by email to set up a time to talk through how your
          business runs today.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/" className="text-sm font-medium underline underline-offset-4">
            Return home
          </Link>
          <Link href="/login" className="text-sm font-medium underline underline-offset-4">
            Already have an account? Log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="name">Your name</FieldLabel>
        <TextInput id="name" name="name" type="text" required autoComplete="name" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="businessName">Business name</FieldLabel>
        <TextInput id="businessName" name="businessName" type="text" required autoComplete="organization" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <TextInput id="email" name="email" type="email" required autoComplete="email" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
        <TextInput id="phone" name="phone" type="tel" autoComplete="tel" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="context">How does your business run today?</FieldLabel>
        <Hint id="context-hint">The tools you use now, and where they fall short.</Hint>
        <TextArea id="context" name="context" rows={4} aria-describedby="context-hint" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="teamSize">Team size (optional)</FieldLabel>
        <TextInput id="teamSize" name="teamSize" type="text" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="businessType">What kind of business is this? (optional)</FieldLabel>
        <TextInput id="businessType" name="businessType" type="text" />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Request a workflow review'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>

      <Hint>
        This starts a conversation, not an account. Want to explore on your own instead?{' '}
        <Link href="/sign-up" className={cx('underline underline-offset-4', FOCUS_RING)}>
          Start here
        </Link>
        .
      </Hint>
    </form>
  );
}
