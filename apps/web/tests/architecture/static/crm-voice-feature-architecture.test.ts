import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPipelineColumns } from '@/features/crm/sales/pipeline-board';

const appRoot = path.resolve(__dirname, '..', '..', '..');

function routeSource(relativePath: string): string {
  return readFileSync(path.join(appRoot, relativePath), 'utf8');
}

describe('CRM and Voice feature boundaries', () => {
  it('keeps the canonical pipeline grouping in CRM Sales', () => {
    expect(
      buildPipelineColumns(
        [{ id: 'new', name: 'New' }, { id: 'won', name: 'Won' }],
        [
          { id: 'a', name: 'Ada', stageId: 'won' },
          { id: 'b', name: 'Bert', stageId: null },
        ],
      ),
    ).toEqual([
      { key: 'new', name: 'New', people: [] },
      { key: 'won', name: 'Won', people: [{ id: 'a', name: 'Ada' }] },
      { key: '', name: 'No stage', people: [{ id: 'b', name: 'Bert' }] },
    ]);
  });

  it('leaves routes responsible for loading and composing named feature UI', () => {
    const calls = routeSource('app/organizations/[organizationId]/calls/page.tsx');
    const customers = routeSource('app/organizations/[organizationId]/crm/contacts/page.tsx');
    const detail = routeSource('app/organizations/[organizationId]/crm/contacts/[contactId]/page.tsx');
    const pipeline = routeSource('app/organizations/[organizationId]/crm/contacts/stages/page.tsx');
    const home = routeSource('app/organizations/[organizationId]/crm/page.tsx');
    expect(home).toContain("@/features/crm/home/crm-home");
    expect(routeSource('features/crm/home/crm-home.tsx')).toContain('<WorkspaceHome');

    expect(calls).toContain("@/features/communications/voice/voice-overview");
    expect(calls).toContain("@/features/settings/workspace-configure");
    expect(customers).toContain("@/features/crm/customers/customer-table");
    expect(customers).toContain("@/features/crm/customers/create-customer-sheet");
    // Package 3A: the link-only Customers Configure panel is retired; CRM configuration lives in its sidebar group.
    expect(customers).not.toContain('ConfigureRegistrar');
    expect(detail).toContain("@/features/crm/customers/customer-detail");
    expect(pipeline).toContain("@/features/crm/sales/pipeline-board");

    for (const source of [calls, customers, detail, pipeline, home]) {
      expect(source).not.toContain('<form');
    }
  });
});
