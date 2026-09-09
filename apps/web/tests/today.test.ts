import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A brand-new organization has no work item types, so both of Today's tiles read zero — which
 * looked identical to "nothing due today" and left an operator with nowhere to go from this
 * screen (product reality audit, Slice B). `work/page.tsx` already carries the sentence for this
 * state ("No kinds of work defined yet"); Today now says the same thing and links to the screen
 * where it stops being true, rather than leaving it to be found unaided.
 *
 * Source scan, for the reason `layout.test.ts` gives for the same choice: an async server
 * component here has no rendering harness this repository runs, so the structural claim is read
 * from the file instead of mounted.
 */

const TODAY = fileURLToPath(
  new URL('../app/organizations/[organizationId]/today/page.tsx', import.meta.url),
);

describe('Today, with nothing configured yet', () => {
  it('names the empty state and links to Work rather than showing two silent zeroes', () => {
    const source = readFileSync(TODAY, 'utf8');

    expect(source).toContain('listWorkItemTypes');
    expect(
      source,
      'no empty state pointing at Work when there are no work item types',
    ).toMatch(/types\.length === 0[\s\S]{0,300}organizations\/\$\{organizationId\}\/work/);
  });
});
