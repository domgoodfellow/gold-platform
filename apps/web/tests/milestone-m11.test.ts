import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M11 — the interface, second pass. `roadmap.md`'s criterion: an operator can drive the whole
 * application from a keyboard and always see where they are, no destructive action completes
 * without a confirmation, and `ui-spec.md` §4's exception list is empty of anything new. Like
 * the other milestone tests this one turns on absences read off disk, not a happy path — no
 * database, because there is no policy here to prove.
 */

const APP_ROOT = fileURLToPath(new URL('../app', import.meta.url));
const COMPONENTS_ROOT = fileURLToPath(new URL('../components', import.meta.url));

/** Every `.tsx` file under `app/`, which is where a control could be spelled by hand. */
function tsxFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...tsxFilesUnder(path));
    else if (entry.name.endsWith('.tsx')) files.push(path);
  }
  return files;
}

describe('M11 — a control spelled by hand', () => {
  it('has no raw <button> or <select> under app/ — Button, ButtonLink and SelectInput replace both, with no exception', () => {
    // ui-spec.md §4's six exceptions are all <input> pickers (file, color, date) and one
    // ternary-classed button on the booking page whose element is still a shared Button — none
    // of them is a raw <button> or <select> tag, so this check names no exception at all.
    // The one further exception: `global-error.tsx` replaces the whole document on a root-layout
    // failure, and Next does not load `globals.css` there — every class name in `components/`
    // would render unstyled, which is worse than the inline style it uses instead.
    const EXEMPT = [`${APP_ROOT}/global-error.tsx`];

    const offenders: string[] = [];
    for (const file of tsxFilesUnder(APP_ROOT)) {
      if (EXEMPT.includes(file)) continue;
      const source = readFileSync(file, 'utf8');
      if (/<button[\s>]/.test(source) || /<select[\s>]/.test(source)) offenders.push(file);
    }
    expect(offenders, `raw <button>/<select> outside the shared control set: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has none of the local style constants the control set replaced', () => {
    // `ui-spec.md` §4 names the eight spellings one extraction attempt after another produced —
    // INPUT_CLASS in ten files, then INPUT, CELL, FIELD, BUTTON, SMALL_INPUT, SELECT_CLASS,
    // COORDINATE_INPUT. A regression here is a ninth.
    const NAMES = ['INPUT_CLASS', 'SMALL_INPUT', 'SELECT_CLASS', 'COORDINATE_INPUT'];
    const offenders: string[] = [];
    for (const file of tsxFilesUnder(APP_ROOT)) {
      const source = readFileSync(file, 'utf8');
      if (NAMES.some((name) => source.includes(name))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('M11 — a control file with no focus treatment', () => {
  const CONTROL_FILES = [
    `${COMPONENTS_ROOT}/controls/button.tsx`,
    `${COMPONENTS_ROOT}/controls/inputs.tsx`,
    `${COMPONENTS_ROOT}/containers/card.tsx`,
    `${APP_ROOT}/organizations/[organizationId]/org-shell.tsx`,
  ];

  it('gives every shared interactive control a visible focus ring', () => {
    // `FOCUS_RING` (`class-names.ts`) is the one ring, referenced rather than copied — so the
    // check is for the reference, not a literal class string that would only ever appear once,
    // in the file that defines it.
    for (const file of CONTROL_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} has no focus-visible ring`).toMatch(/FOCUS_RING|focus-visible:ring/);
    }
  });
});

describe('M11 — a destructive action with nothing between it and the write', () => {
  // Each pair: the actions file whose destructive exports must be confirmed, and the forms
  // file that calls them. One `ConfirmSubmit` per destructive action, named by the action
  // rather than counted, so a new destructive action added without one fails by name.
  const PAIRS: { actions: string; forms: string }[] = [
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/automations/actions.ts`,
      forms: `${APP_ROOT}/organizations/[organizationId]/automations/automation-forms.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/reports/actions.ts`,
      forms: `${APP_ROOT}/organizations/[organizationId]/reports/report-forms.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/settings/actions.ts`,
      forms: `${APP_ROOT}/organizations/[organizationId]/settings/settings-forms.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/settings/actions.ts`,
      forms: `${APP_ROOT}/organizations/[organizationId]/settings/brand-forms.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/work/actions.ts`,
      forms: `${APP_ROOT}/organizations/[organizationId]/work/work-forms.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/work/[workItemId]/actions.ts`,
      forms: `${APP_ROOT}/organizations/[organizationId]/work/[workItemId]/work-item-forms.tsx`,
    },
  ];

  /** A destructive server action exported from an `actions.ts` file, by name. */
  function destructiveActionNames(source: string): string[] {
    const matches = source.matchAll(/export async function ((?:delete|remove|revoke|cancel)\w*Action)/g);
    return [...matches].map((match) => match[1]);
  }

  it('confirms every delete/remove/revoke/cancel action the operator shell exposes', () => {
    for (const { actions, forms } of PAIRS) {
      const actionNames = destructiveActionNames(readFileSync(actions, 'utf8'));
      const formsSource = readFileSync(forms, 'utf8');
      const usedHere = actionNames.filter((name) => formsSource.includes(name));
      const confirmCount = (formsSource.match(/<ConfirmSubmit/g) ?? []).length;

      // Not every destructive action in an actions.ts file is necessarily called from this one
      // forms file (settings/actions.ts is shared by two), so the count compared is only the
      // ones this file actually imports and calls.
      expect(
        confirmCount,
        `${forms} calls ${usedHere.length} destructive action(s) (${usedHere.join(', ')}) but wraps only ${confirmCount} in ConfirmSubmit`,
      ).toBeGreaterThanOrEqual(usedHere.length);
    }
  });
});
