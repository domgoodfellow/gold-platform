import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase C, Slice 11 — the layering `CLAUDE.md`'s Layout section and `lib/application/README.md`
 * describe in words: domain decides, application coordinates, a route handles framework and
 * guards, a feature renders. `lib/application/**` is the use-case/read-model composition layer
 * introduced in Slice 9 — bounded domain reads, provider availability, typed model assembly — and
 * it earns that trust only by being unable to reach the things above it (routes, features,
 * components, React, Next) or to be reached from below it (domain, adapters), the same two-way
 * guarantee `feature-ownership-boundary.test.ts` already proves for `features/**` against `app/**`.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const APPLICATION = `${WEB}/lib/application`;
const DOMAIN = `${WEB}/lib/domain`;
const ADAPTERS = `${WEB}/lib/adapters`;

function tsFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...tsFilesUnder(path));
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

describe('lib/application/** cannot reach upward, and nothing beneath it can reach into it', () => {
  const applicationFiles = tsFilesUnder(APPLICATION).filter((file) => !file.endsWith('README.md'));

  it('finds the application layer, so the rule is not passing over an empty tree', () => {
    expect(applicationFiles.length).toBeGreaterThan(5);
  });

  it('imports no route, feature or component module, and no React or Next route/cache API', () => {
    const offenders: string[] = [];
    for (const file of applicationFiles) {
      const source = readFileSync(file, 'utf8');
      const label = file.slice(APPLICATION.length);
      for (const specifier of importSpecifiers(source)) {
        if (
          specifier.startsWith('@/app/') ||
          specifier.startsWith('@/features/') ||
          specifier.startsWith('@/components/') ||
          specifier === 'react' ||
          specifier.startsWith('react/') ||
          specifier.startsWith('next/')
        ) {
          offenders.push(`${label} imports ${specifier}`);
        }
      }
      // No JSX (a .tsx extension would be the tell — this layer is plain .ts), no hooks, no
      // server-action/redirect/cache primitives: this layer returns data, it never renders.
      if (file.endsWith('.tsx')) offenders.push(`${label} is a .tsx file — this layer renders nothing`);
      if (/\buse(State|Effect|Context)\(/.test(source)) offenders.push(`${label} calls a React hook`);
      if (/\brevalidatePath\(|\bredirect\(|\bnotFound\(\)/.test(source)) {
        offenders.push(`${label} redirects or answers notFound() — that is a route's decision`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lib/domain/** never imports lib/application/**, the dependency runs one way only', () => {
    const offenders: string[] = [];
    for (const file of tsFilesUnder(DOMAIN)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith('@/lib/application')) offenders.push(`${file.slice(DOMAIN.length)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lib/adapters/** never imports lib/application/**, a vendor dialect sits beneath coordination too', () => {
    const offenders: string[] = [];
    for (const file of tsFilesUnder(ADAPTERS)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith('@/lib/application')) offenders.push(`${file.slice(ADAPTERS.length)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
