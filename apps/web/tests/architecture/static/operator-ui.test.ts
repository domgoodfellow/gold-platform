import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
// Phase C (Slice 9) split this route into a loader (`lib/application/work/work-item-detail.ts`)
// and a Screen (`features/work/work-item-detail-screen.tsx`) the thin page delegates to.
const workDetailLoader = readFileSync(`${WEB}/lib/application/work/work-item-detail.ts`, 'utf8');
const workDetailScreen = readFileSync(`${WEB}/features/work/work-item-detail-screen.tsx`, 'utf8');
const workSections = readFileSync(`${WEB}/features/work/work-item-sections.tsx`, 'utf8');
const workList = readFileSync(`${WEB}/features/work/work-list.tsx`, 'utf8');

describe('Today → Work → Work item operator flow', () => {
  it('keeps stage and scheduling actions on the opened work item', () => {
    expect(workDetailLoader).toContain('listWorkItemStatuses');
    expect(workDetailLoader).toContain('listWorkItemTransitions');
    expect(workDetailScreen).toContain('<WorkOperationalActions');
    expect(workSections).toContain('<MoveWorkItemForm');
    expect(workSections).toContain('<ScheduleWorkItemForm');
  });

  it('makes creation the board’s one leading disclosure instead of a permanent trailing form', () => {
    expect(workList).toContain('<WorkCreateDrawer');
    expect(workList).toContain('defaultOpen={createOpen}');
    expect(readFileSync(`${WEB}/features/work/work-create-drawer.tsx`, 'utf8')).toContain('<PageDrawerTrigger asChild><Button size="small">');
  });

  it('leaves no duplicate catch-all work form behind', () => {
    expect(existsSync(`${WEB}/features/work/work-list-forms.tsx`)).toBe(false);
    expect(
      existsSync(
        `${WEB}/app/organizations/[organizationId]/work/[workItemId]/work-item-forms.tsx`,
      ),
    ).toBe(false);
  });
});
