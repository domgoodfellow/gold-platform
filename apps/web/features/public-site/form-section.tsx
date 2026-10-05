import type { FormPublication } from '@gold/schemas';
import { FormPreview } from '@/features/forms/form-preview';
import { KeyedPublicForm } from '@/features/forms/keyed-public-form';

/** How a `form` section is drawn: a real, submitting form on a public page; a look at one in a private preview; a placeholder in Studio's canvas. */
export type FormSectionMode = 'live' | 'preview' | 'canvas';

export type FormSectionContext = {
  mode: FormSectionMode;
  /** The published forms the page names, keyed by form id — read from the forms, never from the website. */
  forms: Record<string, FormPublication>;
  /** Names for the canvas, which does not read definitions. */
  formNames?: Record<string, string>;
};

/**
 * The website's one form section: words around a form the business owns. It holds no field — the
 * form is drawn by the same renderer the hosted page and the builder use, from the form's own
 * published revision. A form that is not published, or was archived, draws nothing on a public page
 * rather than a hole with an apology in it.
 */
export function FormSection({ heading, body, formId, context }: { heading: string; body: string; formId: string; context: FormSectionContext }) {
  const form = context.forms[formId];
  if (!form && context.mode === 'live') return null;

  return (
    <section id="contact" className="scroll-mt-24 mx-auto w-full max-w-xl" aria-labelledby={`form-section-${formId}`}>
      <h2 id={`form-section-${formId}`} className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h2>
      {body ? <p className="mt-3 text-muted">{body}</p> : null}
      <div className="mt-8 rounded-xl border border-border bg-surface p-6 shadow-sm">
        {context.mode === 'canvas' ? (
          <p className="text-sm text-muted">Form: {context.formNames?.[formId] ?? 'not available'}</p>
        ) : !form ? (
          <p className="text-sm text-muted">This form is not published, so visitors will see nothing here.</p>
        ) : context.mode === 'preview' ? (
          <FormPreview definition={form.definition} showTitle={false} />
        ) : (
          <KeyedPublicForm definition={form.definition} revisionId={form.revisionId} publicKey={form.publicKey} source="website" showTitle={false} />
        )}
      </div>
    </section>
  );
}
