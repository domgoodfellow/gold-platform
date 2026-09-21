import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormError, FormField, type FieldControlProps } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { AppPage } from '@/components/containers/app-page';
import { WidgetGrid } from '@/components/display/widget';

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

describe('confirmation dialog composition', () => {
  it('renders an explicit non-submitting trigger before the modal opens', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmSubmit, {
        formId: 'remove-line',
        label: 'Remove',
        confirmLabel: 'Remove line',
        description: 'Remove this line from the quote?',
      }),
    );

    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('Remove');
  });
});

describe('application workspace composition', () => {
  it('is fluid by default and bounded only by an explicit form or reading mode', () => {
    const fluid = renderToStaticMarkup(createElement(AppPage));
    const form = renderToStaticMarkup(createElement(AppPage, { width: 'form' }));

    expect(fluid).not.toContain('max-w-');
    expect(form).toContain('max-w-4xl');
    expect(form).toContain('mx-auto');
  });

  it('uses CSS Grid for responsive dashboard composition', () => {
    const html = renderToStaticMarkup(createElement(WidgetGrid));

    expect(html).toContain('grid');
    expect(html).toContain('2xl:grid-cols-4');
  });
});
