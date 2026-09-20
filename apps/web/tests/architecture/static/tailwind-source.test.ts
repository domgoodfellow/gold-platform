import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

/**
 * The regression: `apps/web/app/globals.css` compiled successfully — `pnpm check` is
 * TypeScript, lint, tests and a Next build, and none of those fail when a class is simply never
 * generated — while the browser rendered a sidebar with no reserved width, because Tailwind v4's
 * automatic content detection walks this file's own directory tree and does not follow the pnpm
 * symlink to a workspace package's real source. A class that appears only inside `@gold/ui` was
 * never scanned and never emitted.
 *
 * Two levels, deliberately: the first is the structural contract (`@source` names the real
 * directory, and the components the shell actually renders live under it) and would have caught
 * exactly this regression on its own. The second runs the *real* `@tailwindcss/postcss` plugin —
 * the one `postcss.config.mjs` wires into the actual build — against the actual file, and proves
 * a class defined only in `@gold/ui` is genuinely emitted, not merely that a directive mentioning
 * it exists. TypeScript/build success was already green when this broke; this is the check that
 * would not have been.
 */

const WEB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GLOBALS_CSS_PATH = fileURLToPath(new URL('../../../app/globals.css', import.meta.url));
const css = readFileSync(GLOBALS_CSS_PATH, 'utf8');

describe('the Tailwind source contract for the shared shadcn package', () => {
  it('registers an @source directive for the workspace UI package', () => {
    expect(css).toMatch(/@source\s+"([^"]*packages\/ui\/src[^"]*)"/);
  });

  it('the registered path actually resolves to packages/ui/src', () => {
    const match = css.match(/@source\s+"([^"]+)"/);
    expect(match).not.toBeNull();

    const sourcePath = fileURLToPath(new URL(match![1], new URL('../../../app/', import.meta.url)));
    expect(existsSync(sourcePath)).toBe(true);
    expect(sourcePath.replace(/\\/g, '/')).toContain('packages/ui/src');
  });

  it('every component the shell relies on actually lives under that path', () => {
    const match = css.match(/@source\s+"([^"]+)"/)!;
    const sourcePath = fileURLToPath(new URL(match[1], new URL('../../../app/', import.meta.url)));

    for (const component of [
      'sidebar.tsx',
      'sheet.tsx',
      'dropdown-menu.tsx',
      'alert.tsx',
      'sonner.tsx',
    ]) {
      expect(existsSync(`${sourcePath}/components/${component}`)).toBe(true);
    }
  });
});

describe('the compiled output, through the real @tailwindcss/postcss plugin', () => {
  it('emits a utility defined only inside packages/ui/src/components/sidebar.tsx', async () => {
    const result = await postcss([tailwindcss({ base: WEB_ROOT })]).process(css, {
      from: GLOBALS_CSS_PATH,
    });

    // `w-(--sidebar-width)` appears nowhere in apps/web — only in the shared `Sidebar`'s own
    // gap/container elements. Its presence in the compiled CSS is not a stand-in for the fixed
    // sidebar width the regression's symptom was missing; it is that reservation.
    expect(result.css).toContain('var(--sidebar-width)');
  });

  it('emits a utility defined only inside packages/ui/src/components/dropdown-menu.tsx', async () => {
    const result = await postcss([tailwindcss({ base: WEB_ROOT })]).process(css, {
      from: GLOBALS_CSS_PATH,
    });

    expect(result.css).toContain('var(--radix-dropdown-menu-trigger-width)');
  });
});
