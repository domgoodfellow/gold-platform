import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * "Every page calls `requireOrganization` for itself" (CLAUDE.md, "Tenancy and access", I12).
 *
 * That rule had nothing holding it. Next reuses a layout across client-side navigations without
 * re-rendering it, so a page that trusted its layout for the membership check would be trusting a
 * cache: RLS would still refuse the read, but the page would render around the refusal, and the
 * "missing" and "not yours" answers would stop being the same. This walks every page inside a
 * business and fails the one that reads without asking.
 *
 * **The Platform pages are held to their own guard, not this one.** They sit beneath GOLD's
 * organization but are not a business's operational screens: each must call `requirePlatformArea`,
 * which proves the organization is GOLD's own, the caller a member and the caller platform staff
 * (`adaptive-shell.test.ts` checks the permission each one names).
 *
 * **The one exception is a page that reads nothing**: a redirect to the screen that moved, or an
 * unmatched-address catch-all that only throws `notFound()`. It
 * holds no database handle and no domain import, so there is nothing for the guard to protect,
 * and the page it redirects to runs the guard itself.
 */

const ORGANIZATION = fileURLToPath(new URL('../../../app/organizations/[organizationId]', import.meta.url));
const WEB = fileURLToPath(new URL('../../..', import.meta.url));

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return pages(full);
    return entry.name === 'page.tsx' ? [full] : [];
  });
}

const rel = (path: string) => relative(WEB, path).split(sep).join('/');
const READS_DATA = /getDb|@\/lib\/domain|@\/lib\/db|requireActor|features\//;

describe('every page inside a business asks for the membership itself', () => {
  const all = pages(ORGANIZATION);

  it('finds the pages, so the rule is not passing over an empty tree', () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it('calls requireOrganization, or is a redirect that reads nothing', () => {
    const unguarded = all
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        if (source.includes('requireOrganization') || source.includes('requirePlatformArea(') || source.includes('requireWorkspaceConfiguration(') || source.includes('requireConfigurationTarget(') || source.includes('requireOperatingArea(')) return false;
        const pureRedirect = /\bredirect\(/.test(source) && !READS_DATA.test(source);
        // The unmatched-address catch-all only throws notFound(), so the segment's own boundary renders.
        const catchAll = /^\s*notFound\(\);/m.test(source) && !READS_DATA.test(source);
        return !pureRedirect && !catchAll;
      })
      .map(rel);

    expect(unguarded).toEqual([]);
  });
});
