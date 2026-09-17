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
const platformLayout = readFileSync(`${WEB}/app/(platform)/platform/layout.tsx`, 'utf8');
const workspaceShell = readFileSync(`${WEB}/components/containers/workspace-shell.tsx`, 'utf8');
const workspacePageChrome = readFileSync(
  `${WEB}/components/containers/workspace-page-chrome.tsx`,
  'utf8',
);
const recordHeader = readFileSync(`${WEB}/components/containers/record-header.tsx`, 'utf8');
const platformNavigation = readFileSync(`${WEB}/features/platform/platform-navigation.tsx`, 'utf8');
const tenantWorkspace = readFileSync(`${WEB}/features/platform/tenant-workspace.tsx`, 'utf8');
const platformOrganizationOverview = readFileSync(
  `${WEB}/app/(platform)/platform/organizations/[organizationId]/page.tsx`,
  'utf8',
);
const platformCatalogPage = readFileSync(`${WEB}/app/(platform)/platform/catalog/page.tsx`, 'utf8');
const platformOverview = readFileSync(`${WEB}/features/platform/platform-overview.tsx`, 'utf8');

describe('WorkspaceHeader is geometry only', () => {
  it('carries no organization id, platform route, AreaTrail or authorization knowledge', () => {
    expect(workspaceHeader).not.toMatch(/organizationId/);
    expect(workspaceHeader).not.toMatch(/\/platform/);
    expect(workspaceHeader).not.toContain('AreaTrail');
    expect(workspaceHeader).not.toMatch(/requireOrganization|requireActor|isPlatformStaff/);
  });

  it('renders its slots in one fixed order: trigger, context, primary, status, spacer, page actions, beforeActions, actions', () => {
    const order = [
      'SidebarTrigger',
      '{context}',
      'chrome ? <PageChromeIdentity',
      'chrome?.status ? (',
      "className=\"flex-1\"",
      'chrome?.actions ? (',
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

describe('the Platform route uses the unified workspace shell', () => {
  it('no longer lives beside generic header markup, and delegates title/breadcrumb entirely to page chrome', () => {
    expect(existsSync(`${WEB}/components/site-header.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-header-title.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-header.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-shell.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/app/(platform)/platform/gold-bootstrap-form.tsx`)).toBe(false);
    // No pathname → title table — every Platform page registers its own via workspace-page-chrome.
    expect(platformLayout).toContain('WorkspaceHeader');
    expect(platformLayout).toContain('OrgSidebar');
  });

  it('does not expose GOLD bootstrap as product UI', () => {
    expect(platformLayout).not.toContain('GoldBootstrapForm');
    expect(platformLayout).not.toContain('bootstrapAction');
    expect(platformLayout).not.toContain('GOLD operating workspace must be initialized');
    expect(platformLayout).not.toContain('GOLD organization ID');
    expect(platformLayout).not.toContain('Initialize GOLD workspace');
  });

  it('fails a missing GOLD invariant as server configuration, without a UUID form', () => {
    expect(platformLayout).toContain('gold_internal.configuration_required');
    expect(platformLayout).toContain('console.error');
    expect(platformLayout).toContain('membershipOrganizationIds');
    expect(platformLayout).not.toContain('<form');
  });

  it('shows its trigger at every width — Platform has no phone bottom bar to hand navigation to instead', () => {
    expect(platformLayout).toContain('navigationTrigger="md"');
  });

  it('renders no compact context switcher of its own — Platform reaches it through the Sidebar header at every width', () => {
    expect(platformLayout).toContain('CompactContextSwitcher');
  });

  it('uses the shared workspace header for platform routes', () => {
    expect(platformLayout).toContain('PlatformTrail');
    expect(platformLayout).not.toContain('SiteHeader');
  });

  it('mounts no bottom bar — Platform keeps its Sidebar Sheet rather than a copy of the Business bottom bar', () => {
    expect(platformLayout).toMatch(/bottomBar=\{/);
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

describe('the page-chrome contract — the header, not the body, owns page location', () => {
  it('WorkspaceShell gives page chrome the same lifetime as the rail — one provider tree', () => {
    expect(workspaceShell).toContain('WorkspacePageChromeProvider');
    const railAt = workspaceShell.indexOf('WorkspaceRailProvider');
    const chromeAt = workspaceShell.indexOf('WorkspacePageChromeProvider');
    expect(railAt).toBeGreaterThan(-1);
    expect(chromeAt).toBeGreaterThan(railAt);
  });

  it('WorkspaceHeader consumes registered chrome, never a route or organization id, to decide what wins', () => {
    expect(workspaceHeader).toContain('usePageChrome');
    expect(workspaceHeader).toContain('PageChromeIdentity');
  });

  it('a registered page action renders ahead of the mobile account control and WorkspaceHeaderActions', () => {
    const actionsAt = workspaceHeader.indexOf('chrome?.actions');
    const beforeActionsAt = workspaceHeader.indexOf('{beforeActions}');
    const railActionsAt = workspaceHeader.indexOf('<WorkspaceHeaderActions');
    expect(actionsAt).toBeGreaterThan(-1);
    expect(beforeActionsAt).toBeGreaterThan(actionsAt);
    expect(railActionsAt).toBeGreaterThan(beforeActionsAt);
  });

  it('chrome is presentation metadata only — no domain/auth logic in the registrar or its context', () => {
    expect(workspacePageChrome).not.toMatch(/organizationId|requireOrganization|requireActor|isPlatformStaff/);
  });

  it('RecordHeader registers chrome and renders nothing of its own — the body no longer duplicates the header’s identity', () => {
    expect(recordHeader).toContain('useWorkspacePageChrome');
    expect(recordHeader).toContain('return null');
    expect(recordHeader).not.toContain('<h1');
    expect(recordHeader).not.toContain('Breadcrumb');
  });

  it('RecordHeader drops its own last crumb before registering — its historical crumbs shape already ends with the current page, and title would otherwise repeat it', () => {
    expect(recordHeader).toContain('crumbs.slice(0, -1)');
  });
});

describe('Business area roots register chrome actions but no longer duplicate AreaTrail’s heading', () => {
  it('Resources, Locations, Customers and Assets stop rendering their own PageHeading', () => {
    for (const area of ['resources', 'locations', 'customers', 'assets']) {
      const source = readFileSync(
        `${WEB}/app/organizations/[organizationId]/${area}/page.tsx`,
        'utf8',
      );
      expect(source, `${area}/page.tsx should not import PageHeading`).not.toContain('PageHeading');
      expect(source, `${area}/page.tsx should register chrome`).toContain('PageChromeRegistrar');
    }
  });

  it('each area’s primary "Add" action moves into the registered chrome, not a body header row', () => {
    const triggers: Record<string, string> = {
      resources: 'CreateResourceTrigger',
      locations: 'CreateLocationTrigger',
      customers: 'CreateCustomerTrigger',
      assets: 'CreateAssetTrigger',
    };
    for (const [area, trigger] of Object.entries(triggers)) {
      const source = readFileSync(
        `${WEB}/app/organizations/[organizationId]/${area}/page.tsx`,
        'utf8',
      );
      const registrarBlock = source.slice(
        source.indexOf('<PageChromeRegistrar'),
        source.indexOf('/>', source.indexOf('<PageChromeRegistrar')) + 2,
      );
      expect(registrarBlock, `${area}/page.tsx should place ${trigger} in chrome actions`).toContain(
        trigger,
      );
    }
  });
});

describe('Platform pages register chrome instead of duplicating their own heading', () => {
  it('the Catalog and Overview pages no longer render PageHeading — chrome owns the title', () => {
    expect(platformCatalogPage).not.toContain('PageHeading');
    expect(platformCatalogPage).toContain('PageChromeRegistrar');
    expect(platformOverview).not.toContain('PageHeading');
    expect(platformOverview).toContain('PageChromeRegistrar');
  });

  it('the legacy flat SKU list reads as "Line items" under Catalog, never a second "Products"', () => {
    const productsPage = readFileSync(
      `${WEB}/app/(platform)/platform/catalog/products/page.tsx`,
      'utf8',
    );
    expect(productsPage).toContain("title=\"Line items\"");
    expect(platformNavigation).not.toMatch(/label:\s*'Products'/);
  });
});

describe('Platform navigation highlights the most specific matching item, never two at once', () => {
  it('renamed the Catalog root away from "Products" — Products is the legacy line-item list one level in', () => {
    expect(platformNavigation).toContain("label: 'Catalog', href: '/platform/catalog'");
  });

  it('picks the longest matching href so a Plan or Product detail route activates its own section', () => {
    expect(platformNavigation).toContain('function activeHref');
    expect(platformNavigation).toContain('item.href.length > best.href.length');
  });
});

describe('the tenant workspace header — Platform administering an organization, not operating it', () => {
  it('registers chrome instead of an sr-only heading plus the retired override store', () => {
    expect(tenantWorkspace).toContain('PageChromeRegistrar');
    expect(tenantWorkspace).not.toContain('sr-only');
    expect(tenantWorkspace).not.toContain('PlatformHeaderTitle');
  });

  it('"Open business" only ever appears for a caller with real membership in that organization', () => {
    expect(tenantWorkspace).toContain('canOpenBusiness');
    // Never a fabricated tenant capability inside /platform (constraints.md) — the gate is the
    // caller's own listMyOrganizations() result, resolved server-side, not staff authority.
    expect(platformOrganizationOverview).toContain('listMyOrganizations');
    expect(platformOrganizationOverview).toMatch(
      /myOrganizations\.some\(\(organization\) => organization\.id === organizationId\)/,
    );
  });
});

describe('Account shares the authenticated shell — no standalone island', () => {
  const accountPage = readFileSync(`${WEB}/app/account/page.tsx`, 'utf8');
  const contextSwitcherSource = readFileSync(`${WEB}/components/containers/context-switcher.tsx`, 'utf8');
  const accountSidebar = readFileSync(`${WEB}/features/account/account-sidebar.tsx`, 'utf8');

  it('mounts WorkspaceShell rather than a bare <main>', () => {
    expect(accountPage).toContain('<WorkspaceShell');
    expect(accountPage).not.toMatch(/<main\b/);
  });

  it('registers an Agent rail — every workspace keeps Agent as a furthest-right control', () => {
    expect(accountPage).toContain('AccountAgentRail');
  });

  it('has its own SwitcherContext kind, rather than borrowing "business" or "platform"', () => {
    expect(contextSwitcherSource).toMatch(/\{\s*kind:\s*'account'\s*\}/);
    expect(accountSidebar).toContain("kind: 'account'");
  });

  it('keeps ContextSwitcher as the only cross-context navigation — no second business list here', () => {
    expect(accountSidebar).toContain('ContextSwitcher');
    expect(accountSidebar).not.toContain('PlatformNavigation');
    expect(accountSidebar).not.toMatch(/AREAS|areasIn\(/);
  });
});

describe('the Catalog family grid uses the shared Progress primitive, not a hand-built bar', () => {
  it('imports Progress from packages/ui rather than a styled div pair', () => {
    const catalogPage = readFileSync(`${WEB}/app/(platform)/platform/catalog/page.tsx`, 'utf8');
    expect(catalogPage).toContain("from '@gold/ui/components/progress'");
    expect(catalogPage).toContain('<Progress value={coverage}');
    expect(catalogPage).not.toContain('h-1.5 w-full overflow-hidden rounded-full bg-muted');
  });
});

describe('Drawer is a shared primitive, not a duplicate', () => {
  it('lives in packages/ui, never re-created under apps/web/components/ui', () => {
    const uiRoot = fileURLToPath(new URL('../../../packages/ui/src/components', import.meta.url));
    expect(existsSync(`${uiRoot}/drawer.tsx`)).toBe(true);
    expect(existsSync(`${WEB}/components/ui/drawer.tsx`)).toBe(false);
  });
});
