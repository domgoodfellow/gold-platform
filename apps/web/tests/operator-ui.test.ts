import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const workRoute = readFileSync(
  `${WEB}/app/organizations/[organizationId]/work/[workItemId]/page.tsx`,
  'utf8',
);
const workSections = readFileSync(`${WEB}/features/work/work-item-sections.tsx`, 'utf8');
const workList = readFileSync(`${WEB}/features/work/work-list.tsx`, 'utf8');

describe('Today → Work → Work item operator flow', () => {
  it('keeps stage and scheduling actions on the opened work item', () => {
    expect(workRoute).toContain('listWorkItemStatuses');
    expect(workRoute).toContain('listWorkItemTransitions');
    expect(workRoute).toContain('<WorkOperationalActions');
    expect(workSections).toContain('<MoveWorkItemForm');
    expect(workSections).toContain('<ScheduleWorkItemForm');
  });

  it('makes creation the board’s one leading disclosure instead of a permanent trailing form', () => {
    expect(workList).toMatch(
      /<Disclosure[\s\S]{0,160}summary="Add work"[\s\S]{0,160}tone="primary"/,
    );
    expect(workList).toContain('defaultOpen={workItems.length === 0}');
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
