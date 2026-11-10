'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { ErrorText, FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { PUBLIC_INTAKE_LIMITS } from '@/lib/domain/public-intake/limits';
import { DIALER_QUESTIONS, INQUIRY_TOPICS, inquiryTopic, inquiryTopicNote } from '@/lib/marketing/inquiry';

export type DemoRequestValues = {
  name: string;
  email: string;
  businessName: string;
  phone: string;
  product: string;
  teamSize: string;
  context: string;
  dialerCallers: string;
  dialerNumbers: string;
  dialerDirection: string;
  dialerVolume: string;
  dialerExtras: string[];
};

export type DemoRequestState = {
  error: string | null;
  done: boolean;
  /** Counts submissions, so a refused one reopens the form with what was typed (`values`). */
  attempt: number;
  values?: DemoRequestValues;
  /** The product the request named, for the thank-you. */
  product?: string | null;
};

const INITIAL: DemoRequestState = { error: null, done: false, attempt: 0 };

const TOPIC_OPTIONS = INQUIRY_TOPICS.map((topic) => ({ value: topic.value, label: topic.label }));

const options = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

/**
 * The one form this route has. A single page rather than a wizard: this is a request to talk,
 * not the start of Business Setup — nothing here creates an account, a membership, or an
 * organization (`lib/domain/public-intake/public-intake.ts`, shared with /contact).
 *
 * The product comes first because it is what the visitor came from: `/demo?product=dialer`
 * arrives with the Dialer chosen and its few optional questions open. The choice is sent with the
 * request and kept on the contact GildOps' CRM creates for it.
 */
export function DemoForm({
  action,
  initialProduct,
}: {
  action: (state: DemoRequestState, formData: FormData) => Promise<DemoRequestState>;
  initialProduct: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (state.done) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <h2 className="text-xl font-semibold tracking-tight">Thanks</h2>
        <p className="max-w-md text-muted">
          We&rsquo;ll review what you shared{state.product ? ` about ${state.product}` : ''} and
          contact you to arrange a consultation.
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
    <DemoFields
      // A refused request reopens the form with what was sent, rather than the empty form React's
      // automatic reset after a form action would leave.
      key={state.attempt}
      formAction={formAction}
      pending={pending}
      error={state.error}
      values={state.values}
      initialProduct={initialProduct}
    />
  );
}

function DemoFields({
  formAction,
  pending,
  error,
  values,
  initialProduct,
}: {
  formAction: (formData: FormData) => void;
  pending: boolean;
  error: string | null;
  values: DemoRequestValues | undefined;
  initialProduct: string | null;
}) {
  const [product, setProduct] = useState(values?.product ?? initialProduct ?? '');
  const note = inquiryTopicNote(inquiryTopic(product));
  const { callers, numbers, direction, volume, extras } = DIALER_QUESTIONS;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="product">Product</FieldLabel>
        <SelectField
          id="product"
          name="product"
          placeholder="Choose one"
          defaultValue={product}
          onValueChange={setProduct}
          options={TOPIC_OPTIONS}
          aria-describedby={note ? 'product-note' : undefined}
        />
        {note ? <Hint id="product-note">{note}</Hint> : null}
      </div>

      {product === 'dialer' ? (
        <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">About your calls (optional)</legend>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={callers.name}>{callers.label}</FieldLabel>
            <SelectField id={callers.name} name={callers.name} placeholder="Choose one" defaultValue={values?.dialerCallers} options={options(callers.options)} />
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={numbers.name}>{numbers.label}</FieldLabel>
            <SelectField id={numbers.name} name={numbers.name} placeholder="Choose one" defaultValue={values?.dialerNumbers} options={options(numbers.options)} />
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={direction.name}>{direction.label}</FieldLabel>
            <SelectField id={direction.name} name={direction.name} placeholder="Choose one" defaultValue={values?.dialerDirection} options={options(direction.options)} />
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={volume.name}>{volume.label}</FieldLabel>
            <TextInput id={volume.name} name={volume.name} type="text" maxLength={volume.maxLength} defaultValue={values?.dialerVolume} />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{extras.label}</legend>
            {extras.options.map((option, index) => (
              <CheckboxField
                key={option}
                id={`${extras.name}-${index}`}
                name={extras.name}
                value={option}
                label={option}
                defaultChecked={values?.dialerExtras.includes(option)}
              />
            ))}
          </fieldset>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="name">Your name</FieldLabel>
        <TextInput id="name" name="name" type="text" required maxLength={PUBLIC_INTAKE_LIMITS.name} autoComplete="name" defaultValue={values?.name} />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="email">Work email</FieldLabel>
        <TextInput id="email" name="email" type="email" required maxLength={PUBLIC_INTAKE_LIMITS.email} autoComplete="email" defaultValue={values?.email} />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="businessName">Business name</FieldLabel>
        <TextInput id="businessName" name="businessName" type="text" required maxLength={PUBLIC_INTAKE_LIMITS.businessName} autoComplete="organization" defaultValue={values?.businessName} />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
        <PhoneInput id="phone" name="phone" type="tel" maxLength={PUBLIC_INTAKE_LIMITS.phone} autoComplete="tel" defaultValue={values?.phone} />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="teamSize">Team size (optional)</FieldLabel>
        <TextInput id="teamSize" name="teamSize" type="text" maxLength={PUBLIC_INTAKE_LIMITS.teamSize} defaultValue={values?.teamSize} />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="context">What do you need? (optional)</FieldLabel>
        <Hint id="context-hint">What you want to fix, and the tools you use now.</Hint>
        <TextArea id="context" name="context" rows={4} maxLength={PUBLIC_INTAKE_LIMITS.context} aria-describedby="context-hint" defaultValue={values?.context} />
      </div>

      <Hint weight="subtle">
        We use these details to respond to this request and keep the conversation with the
        business record it concerns. Submitting this form does not opt you into marketing messages.
      </Hint>

      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Request a consultation'}
      </Button>

      <ErrorText role="alert">{error}</ErrorText>
    </form>
  );
}
