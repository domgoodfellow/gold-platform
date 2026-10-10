import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Slice 0A. Role presets are starting templates for a role's capability checklist
 * (role-presets.ts's own docstring) — never a runtime classification. Choosing "Dispatcher"
 * writes an ordinary `roles` row with an ordinary capability list and no reference back to the
 * preset; nothing anywhere may branch on that row's *name*, or on a preset's *key*, to grant
 * authority a capability list didn't already grant. This is a source-scan for the same reason
 * `auth-boundary.test.ts` is one: the property under test is an absence, and the only reliable
 * way to prove an absence is to read every file rather than trust nobody adds one.
 *
 * Deliberately not a literal-name blocklist (no scan for "Dispatcher"/"Technician" as
 * substrings): those words are also product vocabulary and marketing copy elsewhere in this
 * repository, and a substring match would either miss the real bug or flag prose that has
 * nothing to do with authorization. What actually distinguishes a classification bug is
 * comparing identity by string equality, which is what's checked below.
 */

const ROOT = join(__dirname, '..', '..', '..');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'tests') continue;
      tsFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('role-presets.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('role presets are templates, never runtime classifications', () => {
  it('no source file under lib/, app/, features/ or components/ compares a role/preset identity by string equality', () => {
    const dirs = ['lib', 'app', 'features', 'components'].map((dir) => join(ROOT, dir));
    const files = dirs.flatMap((dir) => tsFiles(dir));

    // The shape a preset-as-classification bug actually takes: comparing a role's own name, or
    // a preset's key/label, against a literal string to decide behaviour, instead of checking
    // the capability list every role and preset already carries.
    const suspectPatterns = [
      // `typeof role.name === 'string'` is a shape check on an untrusted document, not a comparison of identity.
      /(?<!typeof\s)role\.name\s*===/,
      /roleName\s*===/,
      /preset\.key\s*===/,
      /presetKey\s*===/,
      /preset\.label\s*===/,
    ];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of suspectPatterns) {
        expect(source, `${file} must not compare a role/preset identity by string equality`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it('ROLE_PRESETS is consumed only by the role-editing form, not by any authorization or navigation path', () => {
    const dirs = ['lib', 'app', 'features', 'components'].map((dir) => join(ROOT, dir));
    const files = dirs.flatMap((dir) => tsFiles(dir));
    const consumers = files.filter((file) => readFileSync(file, 'utf8').includes('ROLE_PRESETS'));

    for (const file of consumers) {
      expect(file, 'unexpected ROLE_PRESETS consumer').toContain(join('features', 'team'));
    }
  });
});
