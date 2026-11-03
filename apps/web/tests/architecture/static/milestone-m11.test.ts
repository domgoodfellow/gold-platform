import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SIDEBAR_PRIMITIVE = fileURLToPath(
  new URL('../../../../../packages/ui/src/components/sidebar.tsx', import.meta.url),
);

/**
 * M11 — the interface, second pass. Its criterion: an operator can drive the whole
 * application from a keyboard and always see where they are, no destructive action completes
 * without a confirmation, and `docs/ui-system.md`'s exception list is empty of anything new. Like
 * the other milestone tests this one turns on absences read off disk, not a happy path — no
 * database, because there is no policy here to prove.
 */

const APP_ROOT = fileURLToPath(new URL('../../../app', import.meta.url));
const COMPONENTS_ROOT = fileURLToPath(new URL('../../../components', import.meta.url));
const FEATURES_ROOT = fileURLToPath(new URL('../../../features', import.meta.url));

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
  it('has no raw <button> or <select> under app/ — Button, ButtonLink and SelectField replace both, with no exception', () => {
    // `docs/ui-system.md`'s six exceptions are all <input> pickers (file, color, date) and one
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
    // `docs/ui-system.md` names the eight spellings one extraction attempt after another produced —
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
    `${COMPONENTS_ROOT}/surfaces/card.tsx`,
    // The shell's own rows. `app-shell.tsx` used to hold the sign-out control by hand
    // (`SIDEBAR_ROW`/`SidebarButton`, which is where it moved when the first test in this file
    // caught it spelled raw under `app/`) and its own collapse toggle; both are gone now that
    // every shell shares the real `Sidebar` primitive (`SidebarMenuButton`, `SidebarTrigger`,
    // `SidebarRail`) instead of a bespoke `localStorage` implementation reimplementing the same
    // rows beside it — so the control, and its focus ring, live there instead.
    SIDEBAR_PRIMITIVE,
    // The phone bar's own rows — never `Sidebar`'s vocabulary (`docs/ui-system.md`), so they still
    // need their own focus ring, spelled directly in the shell that owns them.
    `${APP_ROOT}/organizations/[organizationId]/org-shell.tsx`,
  ];

  it('gives every shared interactive control a visible focus ring', () => {
    // One indicator (`docs/ui-system.md`, Focus): the global `:focus-visible` rule in globals.css
    // draws it on every native control and role-bearing element, outside every cascade layer so no
    // utility can remove it; `FOCUS_RING` (`class-names.ts`) repeats the same declaration for an
    // element that rule does not match. A control file therefore either renders elements the rule
    // covers or references `FOCUS_RING` — and never draws a second ring or a gap beside it.
    const css = readFileSync(fileURLToPath(new URL('../../../app/globals.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/:where\(a\[href\], button, input, select, textarea[^)]*\)[^{]*:focus-visible \{\s*outline: 2px solid var\(--focus-color\);\s*outline-offset: var\(--focus-offset, 0px\);/);
    for (const file of CONTROL_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} has no focus-visible indicator`).toMatch(/FOCUS_RING|<(button|a|input|textarea)[\s>]|@gold\/ui\/components\/(button|input|textarea)'/);
      expect(source, `${file} draws a competing ring or gap`).not.toMatch(/focus-visible:ring|ring-offset|focus-visible:outline-none/);
    }
  });
});

describe('M11 — a destructive action with nothing between it and the write', () => {
  // Each pair: the actions file whose destructive exports must be confirmed, and the forms
  // file that calls them. One `ConfirmSubmit` per destructive action, named by the action
  // rather than counted, so a new destructive action added without one fails by name.
  const PAIRS: { actions: string; forms: string }[] = [
    {
      // Split from one `automation-forms.tsx` into per-responsibility files (rules/templates/
      // activity/review), then again into the Rules/Messages/Activity workspace recomposition —
      // each destructive action from this one `actions.ts` still needs its `ConfirmSubmit`, just
      // checked against whichever new file actually calls it now.
      actions: `${APP_ROOT}/organizations/[organizationId]/automations/actions.ts`,
      forms: `${FEATURES_ROOT}/automations/rules/rule-heading.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/automations/actions.ts`,
      forms: `${FEATURES_ROOT}/automations/templates/delete-message-dialog.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/insights/actions.ts`,
      forms: `${FEATURES_ROOT}/reporting/report-forms.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/settings/actions.ts`,
      forms: `${FEATURES_ROOT}/tenancy/organization-settings-form.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/settings/actions.ts`,
      forms: `${FEATURES_ROOT}/branding/logo-controls.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/work/actions.ts`,
      forms: `${FEATURES_ROOT}/work/work-operations-forms.tsx`,
    },
    {
      actions: `${APP_ROOT}/organizations/[organizationId]/work/[workItemId]/actions.ts`,
      forms: `${FEATURES_ROOT}/work/pricing-forms.tsx`,
    },
  ];

  /** A destructive server action exported from an `actions.ts` file, by name. */
  function destructiveActionNames(source: string): string[] {
    const matches = source.matchAll(/export async function ((?:delete|remove|revoke|cancel)\w*Action)/g);
    return [...matches].map((match) => match[1]);
  }

  it('confirms removing a condition or an action: one dialog, both destructive actions behind it', () => {
    const removeNode = readFileSync(`${FEATURES_ROOT}/automations/rules/remove-node.tsx`, 'utf8');
    expect(removeNode).toContain('removeConditionAction');
    expect(removeNode).toContain('removeActionAction');
    expect(removeNode).toContain('<ConfirmSubmit');
  });

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
