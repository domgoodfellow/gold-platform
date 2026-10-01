// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { runAxe } from '@/tests/support/axe';

/**
 * `FormField` by rendered behaviour, not by reading its source. `form-field.test.tsx`'s own
 * companion in `tests/component/ui-components.test.ts` already proved its string shape
 * (`aria-describedby`, `aria-invalid`) from static markup; this proves the same facts hold once
 * jsdom actually builds the accessibility tree a screen reader walks — label association resolved
 * by role, not by a matching id string typed twice. See `docs/testing.md`'s component-DOM row.
 */

afterEach(cleanup);

describe('FormField', () => {
  it('associates its visible label with the control by an accessible name, with no error yet', () => {
    render(
      <FormField id="email" label="Email">
        {(controlProps) => <TextInput {...controlProps} />}
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('marks aria-invalid and wires aria-describedby to the rendered error once there is one', () => {
    render(
      <FormField id="email" label="Email" error="That address needs an @.">
        {(controlProps) => <TextInput {...controlProps} />}
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description).toHaveTextContent('That address needs an @.');
  });

  it('includes the hint in aria-describedby alongside the error, both reachable from the control', () => {
    render(
      <FormField id="email" label="Email" hint="We only use this to send a receipt." error="Required.">
        {(controlProps) => <TextInput {...controlProps} />}
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Email' });
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids.length).toBe(2);
    const text = ids.map((id) => document.getElementById(id)?.textContent).join(' ');
    expect(text).toContain('We only use this to send a receipt.');
    expect(text).toContain('Required.');
  });

  it('marks an optional field in its accessible name, so a screen reader hears it too', () => {
    render(
      <FormField id="middle-name" label="Middle name" optional>
        {(controlProps) => <TextInput {...controlProps} />}
      </FormField>,
    );
    expect(screen.getByRole('textbox', { name: /Middle name.*optional/i })).toBeInTheDocument();
  });

  it('has no axe violation in either state, under jsdom\'s own limits (no colour contrast)', async () => {
    const { container } = render(
      <FormField id="email" label="Email" hint="A hint." error="An error.">
        {(controlProps) => <TextInput {...controlProps} />}
      </FormField>,
    );
    expect(await runAxe(container)).toEqual([]);
  });
});
