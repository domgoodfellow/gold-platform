import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormError, FormField, type FieldControlProps } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';

describe('shared form composition', () => {
  it('associates a field with its label, help and error', () => {
    const html = renderToStaticMarkup(
      FormField({
        id: 'report-name',
        label: 'Report name',
        hint: 'Used in the saved list.',
        error: 'A name is required.',
        children: (field: FieldControlProps) =>
          createElement(TextInput, { ...field, name: 'name' }),
      }),
    );

    expect(html).toContain('for="report-name"');
    expect(html).toContain('id="report-name-hint"');
    expect(html).toContain('id="report-name-error"');
    expect(html).toContain('aria-describedby="report-name-hint report-name-error"');
    expect(html).toContain('aria-invalid="true"');
  });

  it('announces a form-level failure', () => {
    const html = renderToStaticMarkup(FormError({ children: 'Could not save.' }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
  });
});
