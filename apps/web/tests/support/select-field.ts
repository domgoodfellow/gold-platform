import { act, fireEvent, screen, within } from '@testing-library/react';

/**
 * Operating `SelectField` (a styled Select, or a searchable Combobox for long lists) the way a person
 * does: open the trigger, pick the option by its role. Both popups portal to the body; an option is
 * found by its visible label or its submitted value (`data-value`).
 */

/** jsdom lacks the pointer-capture and scrolling APIs Radix's popups call. */
export function installSelectFieldDom() {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
}
installSelectFieldDom();

function findOption(listbox: HTMLElement, option: string | RegExp): HTMLElement {
  const options = within(listbox).queryAllByRole('option');
  const found = typeof option === 'string'
    ? options.find(entry => entry.dataset.value === option) ?? options.find(entry => entry.textContent?.trim() === option)
    : options.find(entry => option.test(entry.textContent ?? ''));
  if (!found) throw new Error(`No option ${String(option)} among: ${options.map(entry => `${entry.dataset.value}=${entry.textContent?.trim()}`).join(', ')}`);
  return found;
}

/** The open popup's list (the field's own, by `aria-controls`). */
async function open(field: HTMLElement): Promise<HTMLElement> {
  await act(async () => { fireEvent.click(field); });
  const id = field.getAttribute('aria-controls');
  const listbox = id ? document.getElementById(id) : null;
  if (listbox?.getAttribute('role') === 'listbox') return listbox;
  return (await screen.findAllByRole('listbox')).at(-1)!;
}

/** Chooses `option` (a submitted value or a visible label) in the field whose trigger is `field`. */
export async function chooseOption(field: HTMLElement, option: string | RegExp) {
  const listbox = await open(field);
  const target = findOption(listbox, option);
  await act(async () => { fireEvent.click(target); });
}

async function read(field: HTMLElement, pick: (option: HTMLElement) => string): Promise<string[]> {
  const listbox = await open(field);
  const values = within(listbox).getAllByRole('option').map(pick);
  await act(async () => { fireEvent.keyDown(document.activeElement ?? listbox, { key: 'Escape' }); });
  return values;
}

/** The labels a field offers, in order — opened and closed again, as a person would read them. */
export function optionLabels(field: HTMLElement): Promise<string[]> {
  return read(field, option => option.textContent?.trim() ?? '');
}

/** The values a field would submit for each of its options, in order. */
export function optionValues(field: HTMLElement): Promise<string[]> {
  return read(field, option => option.dataset.value ?? '');
}

/** The field's form copy: the hidden input that carries its name, value and `required`. */
export function fieldInput(field: HTMLElement): HTMLInputElement {
  const input = field.closest('[data-slot=select-field]')?.querySelector<HTMLInputElement>('input[data-slot=select-field-value]');
  if (!input) throw new Error('Not a SelectField trigger');
  return input;
}

/** The value the field submits with its form. */
export function fieldValue(field: HTMLElement): string {
  return fieldInput(field).value;
}
