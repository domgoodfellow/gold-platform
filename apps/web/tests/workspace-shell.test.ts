import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase A — the authenticated application frame Business, Platform, Settings, Import, Schedule
 * and Agent all build on. No harness here mounts a component (this repository runs none — see
 * `layout.test.ts`'s own note on why), so — exactly as `navigation.test.ts` and
 * `operator-ui.test.ts` already do — these are source guards: the geometry contract itself lives
 * in `WorkspaceHeader`/`WorkspaceRightRail`, and what a regression here would actually break is
 * either one drifting from what this file asserts about it, or a caller wiring a slot to the
 * wrong content.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));

const workspaceHeader = readFileSync(`${WEB}/components/containers/workspace-header.tsx`, 'utf8');
const workspaceRightRail = readFileSync(`${WEB}/components/containers/workspace-right-rail.tsx`, 'utf8');
const contextSwitcher = readFileSync(`${WEB}/components/containers/context-switcher.tsx`, 'utf8');
const accountMenu = readFileSync(`${WEB}/components/containers/account-menu.tsx`, 'utf8');
const organizationLayout = readFileSync(
  `${WEB}/app/organizations/[organizationId]/layout.tsx`,
  'utf8',
);
const platformHeader = readFileSync(`${WEB}/features/platform/platform-header.tsx`, 'utf8');
const platformShell = readFileSync(`${WEB}/features/platform/platform-shell.tsx`, 'utf8');

describe('WorkspaceHeader is geometry only', () => {
  it('carries no organization id, platform route, AreaTrail or authorization knowledge', () => {
    expect(workspaceHeader).not.toMatch(/organizationId/);
    expect(workspaceHeader).not.toMatch(/\/platform/);
    expect(workspaceHeader).not.toContain('AreaTrail');
    expect(workspaceHeader).not.toMatch(/requireOrganization|requireActor|isPlatformStaff/);
  });

  it('renders its slots in one fixed order: trigger, context, primary, status, spacer, beforeActions, actions', () => {
    const order = [
      'SidebarTrigger',
      '{context}',
      '{primary}',
      '{status}',
      "className=\"flex-1\"",
      '{beforeActions}',
      '<WorkspaceHeaderActions',
    ];
    let cursor = -1;
    for (const token of order) {
      const at = workspaceHeader.indexOf(token);
      expect(at, `expected to find "${token}" in workspace-header.tsx`).toBeGreaterThan(-1);
      expect(at, `"${token}" is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('ends the row at Agent — Configure/Agent ordering lives in WorkspaceHeaderActions alone, never reimplemented here', () => {
    expect(workspaceHeader).toContain('<WorkspaceHeaderActions />');
    expect(workspaceHeader).not.toContain('Bot');
    expect(workspaceHeader).not.toContain('Settings');
  });
});

describe('WorkspaceHeaderActions keeps Configure before Agent, Agent last', () => {
  it('renders the Configure button before the Agent button', () => {
    const configureAt = workspaceRightRail.indexOf('aria-label="Configure"');
    const agentAt = workspaceRightRail.indexOf('aria-label="Agent"');
    expect(configureAt).toBeGreaterThan(-1);
    expect(agentAt).toBeGreaterThan(configureAt);
  });
});

describe('the Business phone header — compact controls wired to the right slots', () => {
  it('gives the context slot the compact context switcher and nothing else', () => {
    const contextBlock = organizationLayout.slice(
      organizationLayout.indexOf('context={'),
      organizationLayout.indexOf('primary={'),
    );
    expect(contextBlock).toContain('CompactContextSwitcher');
  });

  it('gives beforeActions the compact account menu — Account sits before Configure/Agent, never after', () => {
    const start = organizationLayout.indexOf('beforeActions={');
    const beforeActionsBlock = organizationLayout.slice(start, organizationLayout.indexOf('/>', start));
    expect(beforeActionsBlock).toContain('CompactAccountMenu');
    // The regression this exists for: Account rendered as a sibling *after* `WorkspaceHeader`
    // (or after `WorkspaceHeaderActions`) would put Account to the right of Configure/Agent,
    // which is not the contract (A5/A20 #1) — `beforeActions` is a prop the header itself places
    // ahead of its own actions, so wiring it there is what the contract actually depends on.
    expect(organizationLayout).not.toMatch(/<WorkspaceHeader[\s\S]*\/>\s*<CompactAccountMenu/);
  });

  it('passes navigationTrigger="md" — Business only shows its trigger from md up', () => {
    expect(organizationLayout).toContain('navigationTrigger="md"');
  });

  it('hands the mark, current business and this identity’s other businesses to the compact switcher, same shape the sidebar’s own switcher gets', () => {
    const contextBlock = organizationLayout.slice(
      organizationLayout.indexOf('<CompactContextSwitcher'),
      organizationLayout.indexOf('/>', organizationLayout.indexOf('<CompactContextSwitcher')),
    );
    expect(contextBlock).toContain('mark={mark}');
    expect(contextBlock).toMatch(/kind:\s*'business'/);
    expect(contextBlock).toContain('platformStaff={staff}');
  });
});

describe('the Platform header adapter', () => {
  it('owns pathname → title resolution and no longer lives beside generic header markup', () => {
    expect(existsSync(`${WEB}/components/site-header.tsx`)).toBe(false);
    expect(platformHeader).toContain('usePlatformHeaderOverride');
    expect(platformHeader).toContain('WorkspaceHeader');
  });

  it('shows its trigger at every width — Platform has no phone bottom bar to hand navigation to instead', () => {
    expect(platformHeader).toContain('navigationTrigger="always"');
  });

  it('renders no compact context switcher of its own — Platform reaches it through the Sidebar header at every width', () => {
    expect(platformHeader).not.toContain('ContextSwitcher');
  });

  it('is the header PlatformShell actually mounts', () => {
    expect(platformShell).toContain('PlatformHeader');
    expect(platformShell).not.toContain('SiteHeader');
  });

  it('mounts no bottom bar — Platform keeps its Sidebar Sheet rather than a copy of the Business bottom bar', () => {
    expect(platformShell).not.toMatch(/bottomBar=/);
  });
});

describe('ContextSwitcher — content is about context only', () => {
  it('no longer offers Organization settings — Settings has its own destination', () => {
    expect(contextSwitcher).not.toContain('Organization settings');
  });

  it('shows each business row’s role as secondary text', () => {
    const businessesBlock = contextSwitcher.slice(
      contextSwitcher.indexOf('businesses.map'),
      contextSwitcher.indexOf('platformStaff && current.kind'),
    );
    expect(businessesBlock).toContain('organization.role');
  });

  it('shares one menu-content implementation between the sidebar trigger and the compact trigger', () => {
    expect(contextSwitcher).toContain('function ContextSwitcherMenuContent');
    expect(contextSwitcher.match(/<DropdownMenuContent/g)?.length).toBe(1);
    expect(contextSwitcher).toContain('export function ContextSwitcher(');
    expect(contextSwitcher).toContain('export function CompactContextSwitcher(');
  });
});

describe('AccountMenu — the compact trigger is not built from Sidebar-only geometry', () => {
  it('shares one menu-items implementation — only each trigger’s own DropdownMenuContent positioning differs', () => {
    expect(accountMenu).toContain('function AccountMenuContent');
    // Two wrappers, not two menus: the sidebar trigger positions its content `right` (or `bottom`
    // on mobile) and the compact header trigger always `bottom` — a real difference in where each
    // trigger sits, not a duplicated menu. Both render the one `<AccountMenuContent>`.
    expect(accountMenu.match(/<DropdownMenuContent/g)?.length).toBe(2);
    expect(accountMenu.match(/<AccountMenuContent/g)?.length).toBe(2);
  });

  it('does not build the compact trigger from SidebarMenuButton, which is w-full by design', () => {
    const compactBody = accountMenu.slice(
      accountMenu.indexOf('export function CompactAccountMenu'),
    );
    expect(compactBody).not.toContain('SidebarMenuButton');
    expect(compactBody).not.toContain('SidebarMenu>');
  });
});

describe('the right rail — three responsive layouts, not two', () => {
  it('docks only from 1280px — 1024px left the workspace too narrow beside an expanded sidebar', () => {
    expect(workspaceRightRail).toContain('const DOCK_BREAKPOINT = 1280');
    expect(workspaceRightRail).toContain('const TABLET_BREAKPOINT = 768');
  });

  it('gives tablet width its own overlay Sheet from the right, distinct from the phone Drawer', () => {
    expect(workspaceRightRail).toMatch(/layout === 'overlay'[\s\S]{0,200}side="right"/);
    expect(workspaceRightRail).toMatch(/layout === 'docked'/);
    expect(workspaceRightRail).toContain('<Drawer ');
  });

  it('keeps main un-shrunk in the overlay layout — main renders as a sibling, not inside the resizable split', () => {
    const start = workspaceRightRail.indexOf("layout === 'overlay'");
    const end = workspaceRightRail.indexOf('return (\n    <>\n      {main}\n      <Drawer');
    const overlayBlock = workspaceRightRail.slice(start, end);
    expect(overlayBlock).toContain('{main}');
    expect(overlayBlock).toContain('<Sheet');
    expect(overlayBlock).not.toContain('ResizablePanelGroup');
  });
});

describe('Drawer is a shared primitive, not a duplicate', () => {
  it('lives in packages/ui, never re-created under apps/web/components/ui', () => {
    const uiRoot = fileURLToPath(new URL('../../../packages/ui/src/components', import.meta.url));
    expect(existsSync(`${uiRoot}/drawer.tsx`)).toBe(true);
    expect(existsSync(`${WEB}/components/ui/drawer.tsx`)).toBe(false);
  });
});
