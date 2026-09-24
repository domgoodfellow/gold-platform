import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Slice 6 — the ownership boundary `CLAUDE.md`'s layering rule draws between `features/**` and
 * `app/**`: a feature may call a route's own Server Action (`.../actions.ts`,
 * `.../action-states.ts` or a same-shaped sibling), because that is data flow through a typed
 * function, but it may never import a route-owned presentation component — a `.tsx` that isn't
 * one of those action modules. The reverse direction (`app/**` importing from `features/**`) is
 * the intended one and is not checked here.
 */

const FEATURES = fileURLToPath(new URL('../../../features', import.meta.url));

/** An import naming an action module by shape, the one sanctioned exception. */
const ACTION_MODULE = /(^|\/)(action-states|[\w-]*actions)$/;

/**
 * Pre-existing debt this test does not silently pass over: `organization-shell.tsx` reaches into
 * `org-shell.tsx` for `LockedOrgSidebar`/`OrgNavBar`/`OrgSidebar`, a real presentation component
 * rather than an action module. It predates this boundary and predates this slice's file-ownership
 * inventory; `org-shell.tsx` is also named directly by `milestone-m11.test.ts` and
 * `navigation.test.ts`, so moving it is a change of its own rather than one this test should force
 * silently. Named here so a *second* case cannot arrive by matching a loosened rule.
 */
const KNOWN_EXCEPTIONS = new Set([
  '/shell/organization-shell.tsx:@/app/organizations/[organizationId]/org-shell',
]);

function tsxFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...tsxFilesUnder(path));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Every module specifier a file imports from, including type-only and re-export forms. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) specifiers.push(match[1]);
  return specifiers;
}

describe('a feature imports no route-owned presentation component', () => {
  it('every @/app/ import from features/** names an action module, never a component', () => {
    const offenders: string[] = [];
    for (const file of tsxFilesUnder(FEATURES)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (!specifier.startsWith('@/app/')) continue;
        if (ACTION_MODULE.test(specifier)) continue;
        const key = `${file.slice(FEATURES.length)}:${specifier}`;
        if (KNOWN_EXCEPTIONS.has(key)) continue;
        offenders.push(`${file.slice(FEATURES.length)} imports ${specifier}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('no feature reaches app/ by a relative path — the absolute @/app/ form is the one the rule can scan', () => {
    const offenders: string[] = [];
    for (const file of tsxFilesUnder(FEATURES)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (/^\.\.?\//.test(specifier) && /(^|\/)app\//.test(specifier)) {
          offenders.push(`${file.slice(FEATURES.length)} imports ${specifier}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
