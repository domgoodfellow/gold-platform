import type { Locator } from '@playwright/test';

/**
 * Operating `SelectField` in a real browser the way a person does: open its trigger (role
 * combobox), then pick the option by role from the popup it controls. A short list is a styled
 * Select; a long one is a searchable Combobox, so the popup is found by the trigger's own
 * `aria-controls` rather than assumed. An option is named by its submitted value (`data-value`),
 * its visible label, `{ label }`, `{ value }` or `{ index }` — the same choices Playwright's
 * native `selectOption` took, so a journey keeps asserting the same data.
 */
export type OptionChoice = string | { label?: string | RegExp; value?: string; index?: number };

export async function chooseOption(field: Locator, choice: OptionChoice) {
  const page = field.page();
  // An open Select hides everything outside its popup from role queries, so the open trigger is found by its state.
  await field.click();
  const controls = await page.locator('[aria-expanded=true][aria-controls]').last().getAttribute('aria-controls');
  const list = controls ? page.locator(`[id="${controls}"]`) : page.getByRole('listbox').last();
  const options = list.getByRole('option');
  const byValue = (value: string) => list.locator(`[role=option][data-value="${value.replace(/["\\]/g, '\\$&')}"]`).first();
  // A label is matched exactly, as native `selectOption` did, so "Lead" never picks "Lead qualified".
  const byLabel = (label: string | RegExp) => typeof label === 'string' ? options.filter({ has: page.getByText(label, { exact: true }) }).first() : options.filter({ hasText: label }).first();
  let target: Locator;
  if (typeof choice === 'string') {
    target = (await byValue(choice).count()) ? byValue(choice) : byLabel(choice);
  } else if (choice.value !== undefined) {
    target = byValue(choice.value);
  } else if (choice.label !== undefined) {
    target = byLabel(choice.label);
  } else {
    target = options.nth(choice.index ?? 0);
  }
  await target.click();
}

/** The hidden form copy that carries a SelectField's name and submitted value, for `toHaveValue`. */
export function selectFieldValue(field: Locator): Locator {
  return field.locator('xpath=ancestor::*[@data-slot="select-field"][1]//input[@data-slot="select-field-value"]');
}

async function readOptions(field: Locator, attribute: 'text' | 'value'): Promise<string[]> {
  const page = field.page();
  // An open Select hides everything outside its popup from role queries, so the open trigger is found by its state.
  await field.click();
  const controls = await page.locator('[aria-expanded=true][aria-controls]').last().getAttribute('aria-controls');
  const list = controls ? page.locator(`[id="${controls}"]`) : page.getByRole('listbox').last();
  const options = list.getByRole('option');
  await options.first().waitFor();
  const values = attribute === 'text'
    ? (await options.allTextContents()).map(text => text.trim())
    : await options.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.value ?? ''));
  await page.keyboard.press('Escape');
  return values;
}

/** The labels a SelectField offers, read from its open popup (opened and closed again). */
export function optionTexts(field: Locator): Promise<string[]> {
  return readOptions(field, 'text');
}

/** The value each option would submit, in order. */
export function optionValues(field: Locator): Promise<string[]> {
  return readOptions(field, 'value');
}

/** The chosen option's label as the closed trigger shows it. */
export function selectedLabel(field: Locator): Locator {
  return field.locator('[data-slot=select-value]');
}
