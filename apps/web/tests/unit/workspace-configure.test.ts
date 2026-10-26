import { describe, expect, it } from 'vitest';
import { AREAS, CONFIG_TARGETS, WORKSPACES, WORKSPACE_CONFIGURE, configTarget, workspaceConfigureItems } from '@/lib/navigation';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

const everythingEntitled = {
  enabledModules: new Set(['billing', 'integrations', 'reception', 'drafting', 'automations', 'calls']),
  featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])),
};
const everyPermission = new Set<Capability>(CONFIG_TARGETS.flatMap((target) => target.permission));

describe('workspace Configure doors', () => {
  it('only name registered configuration targets and real workspaces', () => {
    const workspaces = new Set<string>(WORKSPACES.map((workspace) => workspace.key));
    for (const [workspace, doors] of Object.entries(WORKSPACE_CONFIGURE)) {
      expect(workspaces.has(workspace), workspace).toBe(true);
      for (const door of doors) expect(() => configTarget(door.target), `${workspace} → ${door.target}`).not.toThrow();
    }
  });

  it('offers nothing without the configuration permission, however entitled the business is', () => {
    for (const workspace of Object.keys(WORKSPACE_CONFIGURE) as (keyof typeof WORKSPACE_CONFIGURE)[]) {
      expect(workspaceConfigureItems('org', workspace, { ...everythingEntitled, capabilities: new Set() }), workspace).toEqual([]);
    }
  });

  it('offers nothing the business is not entitled to, however permitted the member is', () => {
    const none = { enabledModules: new Set<string>(), featureAvailability: new Set<string>(), capabilities: everyPermission };
    expect(workspaceConfigureItems('org', 'ai', none)).toEqual([]);
    expect(workspaceConfigureItems('org', 'automations', none)).toEqual([]);
  });

  it('resolves each door to its registered path inside the organization, one door per page', () => {
    // Finance offers no doors: its price book is an operating page, currency and payments are General's.
    expect(workspaceConfigureItems('org-1', 'finance', { ...everythingEntitled, capabilities: everyPermission })).toEqual([]);
    const items = workspaceConfigureItems('org-1', 'communications', { ...everythingEntitled, capabilities: everyPermission });
    expect(items.map((item) => item.href)).toContain('/organizations/org-1/comms/configuration/calling');
    // Batch A: no workspace offers two doors to the same page, or a door that is only an anchor into another door's page.
    for (const workspace of Object.keys(WORKSPACE_CONFIGURE) as (keyof typeof WORKSPACE_CONFIGURE)[]) {
      const pages = workspaceConfigureItems('org-1', workspace, { ...everythingEntitled, capabilities: everyPermission }).map((item) => item.href.split('#')[0]);
      expect(new Set(pages).size, workspace).toBe(pages.length);
    }
  });

  it('registers no workspace whose doors are always filtered away (Marketing, Automations)', () => {
    for (const [workspace, doors] of Object.entries(WORKSPACE_CONFIGURE)) {
      expect(doors!.some((door) => { const target = configTarget(door.target); return target.workspace === workspace && target.treatment !== 'operating'; }), workspace).toBe(true);
    }
  });

  it('is gated by the configuration permission, never the permission to operate', () => {
    const operateOnly = new Set<Capability>(['support.read', 'support.case.create'] as Capability[]);
    expect(workspaceConfigureItems('org', 'support', { ...everythingEntitled, capabilities: operateOnly })).toEqual([]);
    expect(workspaceConfigureItems('org', 'support', { ...everythingEntitled, capabilities: new Set(['support.configure', 'support.read'] as Capability[]) }).map((item) => item.label)).toEqual(['Queues', 'Service levels']);
  });
});
