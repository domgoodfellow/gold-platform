'use client';

import { useState, useTransition } from 'react';
import type { FormDefinition } from '@gold/schemas';
import { checkFormAnswers } from '@gold/schemas';
import { FormError } from '@/components/controls/form';
import { Button } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { FormRenderer, type FormErrors, type FormValues } from './form-renderer';

export type PublicFormSubmit = (input: {
  revisionId: string;
  answers: Record<string, unknown>;
  website?: string;
}) => Promise<
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string>; stale: boolean }
>;

/**
 * The hosted form: the shared renderer plus what only a live form does — check answers before
 * sending, send them, and show the confirmation the business wrote. The check here is for the
 * visitor's benefit; the server and the database check again.
 */
export function PublicForm({ definition, revisionId, submit }: { definition: FormDefinition; revisionId: string; submit: PublicFormSubmit }) {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [sent, setSent] = useState(false);
  const [website, setWebsite] = useState('');
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{definition.confirmation.title}</h2>
        {definition.confirmation.message ? <p className="text-sm text-muted">{definition.confirmation.message}</p> : null}
      </div>
    );
  }

  const send = () => {
    const checked = checkFormAnswers(definition, values);
    if (!checked.ok) {
      const { _form, ...fieldErrors } = checked.errors;
      setErrors(fieldErrors);
      setMessage(_form ?? 'Please check the highlighted answers.');
      return;
    }
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await submit({ revisionId, answers: checked.answers, website: website || undefined });
      if (result.status === 'sent') setSent(true);
      else if (result.status === 'error') {
        setErrors(result.fieldErrors);
        setMessage(result.message);
        setStale(result.stale);
      }
    });
  };

  return (
    <FormRenderer
      definition={definition}
      values={values}
      errors={errors}
      disabled={pending}
      onChange={(fieldId, value) => setValues((current) => ({ ...current, [fieldId]: value }))}
      onSubmit={send}
      submitDisabled={stale}
      footer={
        <>
          {/* A honeypot: out of sight and out of the tab order, so only a script fills it in. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
            </label>
          </div>
          {message ? <FormError>{message}</FormError> : null}
          {stale ? (
            <div className="flex items-center gap-3">
              <Button type="button" tone="secondary" size="small" onClick={() => window.location.reload()}>Reload form</Button>
              <Hint>Your answers were not sent.</Hint>
            </div>
          ) : null}
        </>
      }
    />
  );
}
