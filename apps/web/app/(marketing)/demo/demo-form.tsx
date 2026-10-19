'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { FOCUS_RING, cx } from '@/components/class-names';
import { PUBLIC_INTAKE_LIMITS } from '@/lib/domain/public-intake/limits';

export type DemoRequestState = { error: string | null; done: boolean };

const INITIAL: DemoRequestState = { error: null, done: false };

const HELP_OPTIONS = ['Sales', 'Operations', 'Customer service', 'Multiple areas'];

/**
 * The one form this route has. A single page rather than a wizard: this is a request to talk,
 * not the start of Business Setup — nothing here creates an account, a membership, or an
 * organization (`lib/domain/public-intake/public-intake.ts`, shared with /contact).
 */
export function DemoForm({
  action,
}: {
  action: (state: DemoRequestState, formData: FormData) => Promise<DemoRequestState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (state.done) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Thanks</h2>
        <p className="max-w-md text-muted">
          We&rsquo;ll review what you shared and contact you about a demo.
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
        <TextInput id="name" name="name" type="text" required maxLength={PUBLIC_INTAKE_LIMITS.name} autoComplete="name" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="email">Work email</FieldLabel>
        <TextInput id="email" name="email" type="email" required maxLength={PUBLIC_INTAKE_LIMITS.email} autoComplete="email" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="businessName">Business name</FieldLabel>
        <TextInput id="businessName" name="businessName" type="text" required maxLength={PUBLIC_INTAKE_LIMITS.businessName} autoComplete="organization" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
        <PhoneInput id="phone" name="phone" type="tel" maxLength={PUBLIC_INTAKE_LIMITS.phone} autoComplete="tel" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="businessType">What do you want help with?</FieldLabel>
        <SelectInput id="businessType" name="businessType" defaultValue="">
          <option value="" disabled>Choose one</option>
          {HELP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </SelectInput>
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="teamSize">Team size (optional)</FieldLabel>
        <TextInput id="teamSize" name="teamSize" type="text" maxLength={PUBLIC_INTAKE_LIMITS.teamSize} />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="context">Current tools / short context (optional)</FieldLabel>
        <Hint id="context-hint">The tools you use now, and where they fall short.</Hint>
        <TextArea id="context" name="context" rows={4} maxLength={PUBLIC_INTAKE_LIMITS.context} aria-describedby="context-hint" />
      </div>

      <Hint weight="subtle">
        We use these details to respond to this request and keep the conversation with the
        business record it concerns. Submitting this form does not opt you into marketing messages.
      </Hint>

      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Request a demo'}
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
