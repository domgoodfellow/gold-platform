import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREAS } from '@/lib/navigation';

/**
 * One declared fact — a work type is scheduled or it is not — and every consumer asks the same
 * question. A second reader of the column is a second answer to *does this business schedule*,
 * and the usual second reader is a heuristic: a row count, or whether public booking is on.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry) ? [relative(ROOT, join(ROOT, path)).split(sep).join('/')] : [];
  });
}

describe('whether work is scheduled has one reader', () => {
  it('only the work-type domain file filters on the declaration', () => {
    const readers = [...sources('lib'), ...sources('app'), ...sources('features')].filter((file) =>
      /\.(eq|filter)\(\s*['"]schedulable['"]/.test(read(file)),
    );
    expect(readers).toEqual(['lib/domain/work-items/types.ts']);
  });

  it('Schedule, Resources and Locations are withheld by the declaration, and nothing else is', () => {
    const needing = AREAS.filter((area) => area.needsSchedulableWork).map((area) => area.segment);
    expect(needing.sort()).toEqual(['locations', 'resources', 'schedule']);
  });

  it('navigation, Field Home and setup never ask whether booking is on to decide it', () => {
    for (const file of [
      'lib/navigation.ts',
      'lib/shell.ts',
      'lib/application/shell/organization-shell.ts',
      'app/organizations/[organizationId]/field/page.tsx',
      'lib/domain/tenancy/lifecycle.ts',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/listBookableTypes|booking_status_id|bookableSlots/);
    }
  });

  it('scheduling controls on a work item follow its type, not whether it already has a window', () => {
    for (const file of ['features/work/work-item-sections.tsx', 'features/work/work-list.tsx']) {
      expect(read(file), file).toMatch(/maySchedule && (workItem|item)\.type\.schedulable/);
    }
  });
});
