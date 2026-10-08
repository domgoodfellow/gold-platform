import { describe, expect, it } from 'vitest';
import { checkFormAnswers, FormDefinitionSchema, formIsPublishable, newFieldId, type FormDefinition } from '@gold/schemas';
import { addField, duplicateField, moveField, removeField, updateField } from '@/features/studio/forms/form-editing';

const BASE: FormDefinition = {
  title: 'Request a quote',
  submitLabel: 'Send',
  confirmation: { title: 'Thanks', message: 'We will be in touch.' },
  fields: [
    { id: 'name', type: 'short_text', label: 'Your name', required: true },
    { id: 'email', type: 'email', label: 'Email', required: true },
    { id: 'vehicle_type', type: 'select', label: 'What type of vehicle do you have?', options: [{ value: 'car', label: 'Car' }, { value: 'van', label: 'Van' }] },
    { id: 'extras', type: 'checkbox', label: 'Extras', options: [{ value: 'wash', label: 'Wash' }, { value: 'wax', label: 'Wax' }] },
    { id: 'age', type: 'number', label: 'Vehicle age', min: 0, max: 40 },
    { id: 'when', type: 'date', label: 'When' },
    { id: 'agree', type: 'consent', label: 'I agree', required: true },
  ],
};

describe('form definition schema', () => {
  it('accepts a definition in the supported vocabulary', () => {
    expect(FormDefinitionSchema.safeParse(BASE).success).toBe(true);
  });

  it('rejects a field type outside the vocabulary', () => {
    const bad = { ...BASE, fields: [{ id: 'x', type: 'html', label: 'X' }] };
    expect(FormDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects two fields with one identity', () => {
    const bad = { ...BASE, fields: [BASE.fields[0], { ...BASE.fields[1], id: 'name' }] };
    expect(FormDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a choice field with no options, or two options sharing a value', () => {
    expect(FormDefinitionSchema.safeParse({ ...BASE, fields: [{ id: 'c', type: 'radio', label: 'C', options: [] }] }).success).toBe(false);
    const dup = { ...BASE, fields: [{ id: 'c', type: 'radio', label: 'C', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] }] };
    expect(FormDefinitionSchema.safeParse(dup).success).toBe(false);
  });

  it('rejects a key a field type does not have, and a smallest value above the largest', () => {
    expect(FormDefinitionSchema.safeParse({ ...BASE, fields: [{ id: 'n', type: 'email', label: 'N', options: [] }] }).success).toBe(false);
    expect(FormDefinitionSchema.safeParse({ ...BASE, fields: [{ id: 'n', type: 'number', label: 'N', min: 5, max: 1 }] }).success).toBe(false);
  });

  it('rejects an id that is not a stable identifier', () => {
    expect(FormDefinitionSchema.safeParse({ ...BASE, fields: [{ id: 'Your Name', type: 'short_text', label: 'N' }] }).success).toBe(false);
  });

  it('lets a draft be empty but not a published form', () => {
    const empty = FormDefinitionSchema.parse({ ...BASE, fields: [] });
    expect(formIsPublishable(empty)).toBe(false);
    expect(formIsPublishable(FormDefinitionSchema.parse(BASE))).toBe(true);
  });

  it('derives an unused id from a label, once', () => {
    expect(newFieldId('Short text', new Set())).toBe('short_text');
    expect(newFieldId('Short text', new Set(['short_text']))).toBe('short_text_2');
    expect(newFieldId('123 !!', new Set())).toBe('field');
  });
});

describe('answers are checked against the definition', () => {
  const good = { name: ' Ada ', email: 'ada@example.com', vehicle_type: 'car', extras: ['wash'], age: '12', when: '2026-03-04', agree: true };

  it('normalises acceptable answers and drops blank optional ones', () => {
    const result = checkFormAnswers(BASE, { ...good, when: '' });
    expect(result).toEqual({ ok: true, answers: { name: 'Ada', email: 'ada@example.com', vehicle_type: 'car', extras: ['wash'], age: 12, agree: true } });
  });

  it('requires what is required', () => {
    const result = checkFormAnswers(BASE, { ...good, name: '', agree: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['agree', 'name']);
  });

  it('refuses a malformed value for each type', () => {
    const result = checkFormAnswers(BASE, { ...good, email: 'nope', vehicle_type: 'boat', extras: ['wash', 'wash'], age: '99', when: '2026-02-31' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['age', 'email', 'extras', 'vehicle_type', 'when']);
  });

  it('refuses an answer to a question the form does not ask', () => {
    const result = checkFormAnswers(BASE, { ...good, surprise: 'x' });
    expect(result.ok).toBe(false);
  });

  it('refuses text over the limit', () => {
    const result = checkFormAnswers(BASE, { ...good, name: 'x'.repeat(501) });
    expect(result.ok).toBe(false);
  });
});

describe('builder edits keep a field\'s identity', () => {
  it('adds fields with distinct ids and never beyond the limit', () => {
    let definition = FormDefinitionSchema.parse({ ...BASE, fields: [] });
    for (let i = 0; i < 3; i += 1) definition = addField(definition, 'short_text').definition;
    expect(definition.fields.map((field) => field.id)).toEqual(['short_text', 'short_text_2', 'short_text_3']);
    expect(FormDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it('gives a new choice field two valid, distinct choices', () => {
    const { definition } = addField(FormDefinitionSchema.parse({ ...BASE, fields: [] }), 'radio');
    expect(FormDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it('keeps the id when a label is edited', () => {
    const next = updateField(BASE, 'vehicle_type', { ...BASE.fields[2], id: 'something_else', label: 'Vehicle?' });
    expect(next.fields[2].id).toBe('vehicle_type');
    expect(next.fields[2].label).toBe('Vehicle?');
  });

  it('reorders by one place and stops at the ends', () => {
    const down = moveField(BASE, 'name', 1);
    expect(down.fields.map((field) => field.id).slice(0, 2)).toEqual(['email', 'name']);
    expect(moveField(BASE, 'name', -1)).toBe(BASE);
    expect(moveField(BASE, 'agree', 1)).toBe(BASE);
  });

  it('removes a field', () => {
    expect(removeField(BASE, 'age').fields.some((field) => field.id === 'age')).toBe(false);
  });

  it('duplicates choices with independent identity and content', () => {
    const source = structuredClone(BASE);
    const result = duplicateField(source, 'vehicle_type');
    const copy = result.definition.fields.find((field) => field.id === result.fieldId)!;
    expect(copy.id).not.toBe('vehicle_type');
    expect(FormDefinitionSchema.safeParse(result.definition).success).toBe(true);
    if (copy.type === 'select') copy.options[0].label = 'Changed copy';
    const original = source.fields.find((field) => field.id === 'vehicle_type');
    expect(original?.type === 'select' && original.options[0].label).toBe('Car');
  });
});
