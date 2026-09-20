import { readdirSync, readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * An area presents itself as widgets, and any of them opens as the screen.
 *
 * **This is not the `dashboards` in `lib/domain/reporting/`, and the two must not converge.** That
 * one is a business's own arrangement of saved reports, and `CLAUDE.md` refuses to let the
 * platform seed one — including the four names in `roadmap.md` — because which numbers a business
 * watches is configuration rather than four screens. This is how an *area* draws itself, which
 * has always been the platform's to decide. Nothing here seeds a `dashboards` row, and no
 * assertion below reads that table.
 *
 * The two rules worth holding are both about the expanded view being a place rather than a mood.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const AREAS = fileURLToPath(new URL('../../../app/organizations', import.meta.url));
const WIDGET = fileURLToPath(new URL('../../../components/display/widget.tsx', import.meta.url));

function tsxFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${sep}${entry.name}`;
    if (entry.isDirectory()) return tsxFilesUnder(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('a widget that opens', () => {
  it('opens to a URL rather than to remembered state', () => {
    // `?widget=` on the area's own page, which is what makes the expanded view survive a reload,
    // arrive with the back button, and read its rows on the server under the caller's own RLS.
    // A client component holding `open` in `useState` would have none of those properties, and
    // the first thing to go would be the reload — so the check is that this file never became
    // one, rather than that it currently is not.
    const source = readFileSync(WIDGET, 'utf8');

    expect(source, 'widget.tsx became a client component').not.toMatch(/^\s*['"]use client['"]/m);
    expect(source, 'widget.tsx holds state of its own').not.toMatch(/useState|useReducer/);
  });

  it('leads somewhere the page can answer', () => {
    // A tile linking to `?widget=x` on a page that never reads `searchParams` is a link to
    // itself: the grid re-renders unchanged and the tile appears broken. Same shape of check as
    // `navigation.test.ts`'s — an entry with no route behind it.
    const offenders = tsxFilesUnder(AREAS)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('?widget=') && !source.includes('searchParams');
      })
      .map((file) => relative(WEB, file).split(sep).join('/'));

    expect(offenders).toEqual([]);
  });
});
