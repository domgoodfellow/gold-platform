import { readdirSync, readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A container that centres itself must also say how wide it is.
 *
 * **What shipped, and what it looked like.** `app/layout.tsx` lays `<body>` out as a flex
 * column, so that the sign-in screen can fill the viewport's height and centre in it. Every
 * page outside the operator shell is a direct child of that body, and each one centred itself
 * the ordinary way: `mx-auto max-w-2xl`. In a flex container an automatic margin on the cross
 * axis absorbs the free space *instead of* stretching the item, so `align-self: stretch` never
 * applied and each `<main>` collapsed to the width of its own text. `max-w-2xl` was never
 * reached, because the box never got near 672px in the first place.
 *
 * The result was not subtle and was live on every surface this platform shows a stranger: the
 * marketing page, both auth screens, `/organizations`, the platform console, `/book/{slug}` and
 * `/portal/{token}`. A heading and a *Sign out* button sat welded together in the middle of an
 * empty page, because `justify-between` had no width left to distribute. Only the screens inside
 * `AppShell` were spared, and only because its `<main>` sits in a grid cell rather than a flex
 * one.
 *
 * **Why this is a source scan and not a rendering test.** The obvious answer — mount the layout
 * and measure it — cannot work: jsdom implements no layout at all, so it computes no flex
 * stretch and no used width, and would report the same class list either way. Measuring this
 * honestly needs a real browser, which this repository does not run. So the rule is enforced one
 * level up, the way `public-profile.test.ts` enforces a business's own words: read the source and
 * fail on the pattern. The whole of it is that `w-full` and `mx-auto` travel together, which is
 * correct in a grid cell and in an ordinary block too — so it is one rule for every surface
 * rather than a rule about which parent a page happens to have today.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));

const ROOTS = ['../app', '../components', '../features'].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

/** Any quoted class list holding `mx-auto` — `className="…"` and a `cx('…')` argument alike. */
const CENTRED = /(['"`])([^'"`\n]*\bmx-auto\b[^'"`\n]*)\1/g;

function tsxFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${sep}${entry.name}`;
    if (entry.isDirectory()) return tsxFilesUnder(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('a self-centring container', () => {
  it('declares its width, so a flex parent cannot shrink it to its text', () => {
    const offenders = ROOTS.flatMap((root) =>
      tsxFilesUnder(root).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(CENTRED)]
          .filter((match) => !match[2].includes('w-full'))
          // The path relative to `apps/web`, since an absolute one differs per machine and the
          // point of the message is to name the line to open.
          .map((match) => `${relative(WEB, file).split(sep).join('/')}: ${match[2]}`),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('is a real rule here, because the body it sits in is a flex column', () => {
    // The precondition. If this ever stops being true the rule above becomes belt and braces
    // rather than load-bearing, and this assertion is what tells its next reader which it is.
    const rootLayout = readFileSync(`${WEB}app${sep}layout.tsx`, 'utf8');

    expect(rootLayout).toMatch(/<body[^>]*className="[^"]*\bflex\b[^"]*\bflex-col\b/);
  });
});
