import { z } from 'zod';

/**
 * The form definition vocabulary and the answer check that goes with it. Shared by the Studio
 * builder, the public renderer and the server actions, so a field means the same thing in all
 * three. The database repeats both rules (`app.form_definition_is_valid`, `app.form_answers_problem`)
 * and is the authority; this exists for a better error message and for the browser.
 *
 * A field's `id` is its identity and what a submission is keyed by. A label is only copy.
 */

export const FORM_FIELD_TYPES = [
  'short_text', 'long_text', 'email', 'phone', 'number', 'date', 'select', 'radio', 'checkbox', 'consent',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_FIELD_TYPE_LABEL: Record<FormFieldType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  radio: 'Single choice',
  checkbox: 'Multiple choice',
  consent: 'Consent',
};

export const FORM_CHOICE_TYPES: readonly FormFieldType[] = ['select', 'radio', 'checkbox'];
export const FORM_MAX_FIELDS = 40;
export const FORM_MAX_OPTIONS = 30;

const FieldId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'A field id is lowercase letters, digits and underscores.');
const OptionSchema = z.object({
  value: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(120),
}).strict();

const base = {
  id: FieldId,
  label: z.string().trim().min(1).max(160),
  description: z.string().max(300).optional(),
  placeholder: z.string().max(120).optional(),
  required: z.boolean().optional(),
};

export const FormFieldSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('short_text'), maxLength: z.number().int().min(1).max(4000).optional() }).strict(),
  z.object({ ...base, type: z.literal('long_text'), maxLength: z.number().int().min(1).max(4000).optional() }).strict(),
  z.object({ ...base, type: z.literal('email') }).strict(),
  z.object({ ...base, type: z.literal('phone') }).strict(),
  z.object({ ...base, type: z.literal('number'), min: z.number().optional(), max: z.number().optional() }).strict(),
  z.object({ ...base, type: z.literal('date') }).strict(),
  z.object({ ...base, type: z.literal('select'), options: z.array(OptionSchema).min(1).max(FORM_MAX_OPTIONS) }).strict(),
  z.object({ ...base, type: z.literal('radio'), options: z.array(OptionSchema).min(1).max(FORM_MAX_OPTIONS) }).strict(),
  z.object({ ...base, type: z.literal('checkbox'), options: z.array(OptionSchema).min(1).max(FORM_MAX_OPTIONS) }).strict(),
  z.object({ ...base, type: z.literal('consent') }).strict(),
]);
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(600).optional(),
  submitLabel: z.string().trim().min(1).max(40),
  confirmation: z.object({
    title: z.string().trim().min(1).max(120),
    message: z.string().max(600),
  }).strict(),
  fields: z.array(FormFieldSchema).max(FORM_MAX_FIELDS),
}).strict().superRefine((definition, context) => {
  const seen = new Set<string>();
  definition.fields.forEach((field, index) => {
    if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      context.addIssue({ code: 'custom', path: ['fields', index, 'min'], message: 'The smallest value is above the largest.' });
    }
    if (seen.has(field.id)) context.addIssue({ code: 'custom', path: ['fields', index, 'id'], message: 'Two fields share an id.' });
    seen.add(field.id);
    if ('options' in field) {
      const values = new Set<string>();
      field.options.forEach((option, optionIndex) => {
        if (values.has(option.value)) context.addIssue({ code: 'custom', path: ['fields', index, 'options', optionIndex, 'value'], message: 'Two choices share a value.' });
        values.add(option.value);
      });
    }
  });
});
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;

/** A form somebody can publish has at least one question; a draft may still be empty. */
export function formIsPublishable(definition: FormDefinition): boolean {
  return definition.fields.length > 0;
}

export type FormAnswerValue = string | number | boolean | string[];
export type FormAnswers = Record<string, FormAnswerValue>;

export type FormAnswerCheck =
  | { ok: true; answers: FormAnswers }
  | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_ANSWERS_BYTES = 20000;

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === false
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

/**
 * Check raw answers against the revision they were given for. Blank optional answers are dropped,
 * text is trimmed, a number arriving as text from a browser input becomes a number. Keys that are
 * not a field of this definition are an error, never silently kept.
 */
export function checkFormAnswers(definition: FormDefinition, raw: Record<string, unknown>): FormAnswerCheck {
  const errors: Record<string, string> = {};
  const answers: FormAnswers = {};
  const known = new Set(definition.fields.map((field) => field.id));

  for (const key of Object.keys(raw)) {
    if (!known.has(key)) errors._form = 'An answer was given for a question this form does not ask.';
  }

  for (const field of definition.fields) {
    const value = raw[field.id];
    if (isBlank(value)) {
      if (field.required) errors[field.id] = 'This is required.';
      continue;
    }

    switch (field.type) {
      case 'short_text':
      case 'long_text': {
        const text = String(value).trim();
        const cap = field.maxLength ?? (field.type === 'short_text' ? 500 : 4000);
        if (text.length > cap) errors[field.id] = `Please keep this under ${cap} characters.`;
        else answers[field.id] = text;
        break;
      }
      case 'email': {
        const text = String(value).trim();
        if (text.length > 320 || !EMAIL.test(text)) errors[field.id] = 'That email address is not valid.';
        else answers[field.id] = text;
        break;
      }
      case 'phone': {
        const text = String(value).trim();
        if (text.length < 3 || text.length > 50) errors[field.id] = 'That phone number is not valid.';
        else answers[field.id] = text;
        break;
      }
      case 'date': {
        const text = String(value).trim();
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
        if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) errors[field.id] = 'That date is not valid.';
        else answers[field.id] = text;
        break;
      }
      case 'number': {
        const number = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isFinite(number)) errors[field.id] = 'That is not a number.';
        else if (field.min !== undefined && number < field.min) errors[field.id] = `Please enter ${field.min} or more.`;
        else if (field.max !== undefined && number > field.max) errors[field.id] = `Please enter ${field.max} or less.`;
        else answers[field.id] = number;
        break;
      }
      case 'select':
      case 'radio': {
        const text = String(value);
        if (!field.options.some((option) => option.value === text)) errors[field.id] = 'Please choose one of the options.';
        else answers[field.id] = text;
        break;
      }
      case 'checkbox': {
        const list = Array.isArray(value) ? value.map(String) : [String(value)];
        const valid = new Set(field.options.map((option) => option.value));
        if (new Set(list).size !== list.length || list.some((item) => !valid.has(item))) errors[field.id] = 'Please choose from the options.';
        else answers[field.id] = list;
        break;
      }
      case 'consent': {
        answers[field.id] = true;
        break;
      }
    }
  }

  if (Object.keys(errors).length === 0 && new TextEncoder().encode(JSON.stringify(answers)).length > MAX_ANSWERS_BYTES) {
    errors._form = 'The answers are too large.';
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers };
}

/** Turn a label into a stable, unused field id. Used once, when a field is created; never again. */
export function newFieldId(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9_]+/, '').slice(0, 30) || 'field';
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}_${n}`;
  return candidate;
}

/** A choice's value is derived from its label once, then kept even if the label is edited. */
export function newOptionValue(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'option';
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}_${n}`;
  return candidate;
}

/** A published form as any surface that is not the form's own page reads it. */
export const FormPublicationSchema = z.object({
  formId: z.string().uuid(),
  publicKey: z.string().regex(/^[a-f0-9]{12}$/),
  revisionId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  name: z.string(),
  definition: FormDefinitionSchema,
}).strict();
export type FormPublication = z.infer<typeof FormPublicationSchema>;

/** Where a response was submitted from. `portal` and `booking` are only ever written by their own owner. */
export const FORM_SOURCES = ['hosted', 'website', 'portal', 'booking', 'embed'] as const;
export type FormSource = (typeof FORM_SOURCES)[number];
export const FORM_SOURCE_LABEL: Record<FormSource, string> = {
  hosted: 'Hosted form',
  website: 'Website',
  portal: 'Customer portal',
  booking: 'Booking',
  embed: 'Embedded on another site',
};

/** The form plus the business's own public identity, for a page that is only the form. */
export const FormProjectionSchema = FormPublicationSchema.extend({
  profile: z.object({
    displayName: z.string(),
    tagline: z.string().nullable(),
    intro: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    address: z.string().nullable(),
  }).strict(),
  brand: z.object({
    accent: z.string().nullable(),
    headingFont: z.enum(['sans', 'serif', 'mono']),
    bodyFont: z.enum(['sans', 'serif', 'mono']),
    logoPath: z.string().nullable(),
  }).strict(),
}).strict();
export type FormProjection = z.infer<typeof FormProjectionSchema>;
