import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormError, FormField, type FieldControlProps } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { RecordHeader } from '@/components/containers/record-header';
import { ConfirmSubmit } from '@/components/containers/dialog';

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

describe('record header composition', () => {
  it('provides route context, one page heading and an accessible current crumb', () => {
    const html = renderToStaticMarkup(
      RecordHeader({
        title: 'Boiler service',
        crumbs: [
          { label: 'Work', href: '/organizations/acme/work' },
          { label: 'Service', href: '/organizations/acme/work?type=service' },
          { label: 'Boiler service' },
        ],
        summary: 'Not scheduled',
      }),
    );

    expect(html).toContain('aria-label="breadcrumb"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('<h1');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Not scheduled');
  });
});

describe('confirmation dialog composition', () => {
  it('names and describes the modal confirmation', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmSubmit, {
        formId: 'remove-line',
        label: 'Remove',
        confirmLabel: 'Remove line',
        description: 'Remove this line from the quote?',
      }),
    );

    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];

    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain('Remove this line from the quote?');
  });
});
