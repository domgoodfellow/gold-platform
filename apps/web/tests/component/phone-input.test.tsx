// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PhoneInput } from '@/components/controls/phone-input';

afterEach(cleanup);

describe('phone entry presentation', () => {
  it('shows formatted text while submitting the original number, including after editing', () => {
    const { container } = render(<form><PhoneInput aria-label="Phone" name="phone" defaultValue="+14165550176" /></form>);
    const input = screen.getByRole('textbox', { name: 'Phone' });
    const form = container.querySelector('form')!;
    expect(input).toHaveValue('(416)555-0176');
    expect(new FormData(form).get('phone')).toBe('+14165550176');
    fireEvent.focus(input);
    expect(input).toHaveValue('+14165550176');
    fireEvent.change(input, { target: { value: '+16135550199' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('(613)555-0199');
    expect(new FormData(form).getAll('phone')).toEqual(['+16135550199']);
    act(() => form.reset());
    expect(input).toHaveValue('(416)555-0176');
    expect(new FormData(form).get('phone')).toBe('+14165550176');
  });

  it('keeps disabled values out of submissions and retains the accessible label', () => {
    const { container } = render(<form><label htmlFor="phone">Phone</label><PhoneInput id="phone" name="phone" defaultValue="+14165550176" disabled /></form>);
    expect(screen.getByLabelText('Phone')).toBeDisabled();
    expect(new FormData(container.querySelector('form')!).has('phone')).toBe(false);
  });

  it('preserves international and incomplete values during display and submission', () => {
    const { rerender, container } = render(<form><PhoneInput aria-label="Phone" name="phone" value="+442079460000" /></form>);
    expect(screen.getByLabelText('Phone')).toHaveValue('+442079460000');
    rerender(<form><PhoneInput aria-label="Phone" name="phone" value="+1416" /></form>);
    expect(screen.getByLabelText('Phone')).toHaveValue('+1416');
    expect(new FormData(container.querySelector('form')!).get('phone')).toBe('+1416');
  });

  it('keeps country-code validation valid for a formatted preview and rejects invalid original values', () => {
    const pattern = '\\+[1-9][0-9]{7,14}';
    const { rerender } = render(<PhoneInput aria-label="Phone" value="+14165550176" pattern={pattern} required />);
    expect((screen.getByLabelText('Phone') as HTMLInputElement).checkValidity()).toBe(true);
    rerender(<PhoneInput aria-label="Phone" value="4165550176" pattern={pattern} required />);
    expect((screen.getByLabelText('Phone') as HTMLInputElement).checkValidity()).toBe(false);
    rerender(<PhoneInput aria-label="Phone" value="" pattern={pattern} required />);
    expect((screen.getByLabelText('Phone') as HTMLInputElement).checkValidity()).toBe(false);
  });
});
