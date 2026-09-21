import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase A — the authenticated application frame Business, Platform, Settings, Import, Schedule
 * and Agent all build on. No harness here mounts a component (this repository runs none — see
 * `layout.test.ts`'s own note on why), so — exactly as `navigation.test.ts` and
 * `operator-ui.test.ts` already do — these are source guards: the ownership contract itself lives
 * in `WorkspaceHeader` (global), `PageHeader` (page identity) and `WorkspaceRightRail` (auxiliary surface), and what a regression here would actually break is
 * either one drifting from what this file asserts about it, or a caller wiring a slot to the
 * wrong content.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));

// Doc comments legitimately name what a file does not do; only the code is under test.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
const pageHeader = readFileSync(`${WEB}/components/containers/page-header.tsx`, 'utf8');
const orgShell = readFileSync(`${WEB}/app/organizations/[organizationId]/org-shell.tsx`, 'utf8');
const resourcesPage = readFileSync(
  `${WEB}/app/organizations/[organizationId]/resources/page.tsx`,
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

describe('WorkspaceHeader is the global bar, not a page header', () => {
  it('carries no organization id, platform route, area trail or authorization knowledge', () => {
    expect(workspaceHeader).not.toMatch(/organizationId/);
    expect(workspaceHeader).not.toMatch(/\/platform/);
    expect(workspaceHeader).not.toMatch(/AreaTrail|PlatformTrail/);
    expect(workspaceHeader).not.toMatch(/requireOrganization|requireActor|isPlatformStaff/);
  });

  it('renders no page title, status or page actions — it accepts no slot for them, only the breadcrumb slot', () => {
    const source = code(workspaceHeader);
    expect(source).not.toMatch(/usePageChrome|PageChrome|PageHeader/);
    expect(source).not.toMatch(/\bprimary\b|\bstatus\b/);
    expect(source).not.toContain('<h1');
    expect(source).toContain('<WorkspaceCrumbSlot />');
  });

  it('renders its slots in one fixed order: trigger, context, breadcrumbs, spacer, beforeActions, Agent', () => {
    const order = [
      'SidebarTrigger',
      '{context}',
      '<WorkspaceCrumbSlot',
      'className="flex-1"',
      '{beforeActions}',
      '<AgentTrigger',
    ];
    let cursor = -1;
    for (const token of order) {
      const at = workspaceHeader.indexOf(token);
      expect(at, `expected to find "${token}" in workspace-header.tsx`).toBeGreaterThan(-1);
      expect(at, `"${token}" is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('still exposes Agent as its furthest-right control, and no Configure', () => {
    expect(workspaceHeader).toContain('<AgentTrigger />');
    expect(code(workspaceHeader)).not.toMatch(/Configure|Settings/);
  });
});

describe('Agent is workspace-global and Configure is page-level', () => {
  it('AgentTrigger is the rail\'s global Agent control, labelled and pressed-state aware', () => {
    expect(workspaceRightRail).toContain('export function AgentTrigger');
    expect(workspaceRightRail).toContain('aria-label="Agent"');
    expect(workspaceRightRail).toContain('aria-pressed={agentOpen}');
  });

  it('ConfigureTrigger is a separate export a page places itself, with pressed state', () => {
    expect(workspaceRightRail).toContain('export function ConfigureTrigger');
    expect(workspaceRightRail).toContain('aria-pressed={configureOpen}');
    const agentBody = workspaceRightRail.slice(
      workspaceRightRail.indexOf('export function AgentTrigger'),
      workspaceRightRail.indexOf('export function ConfigureTrigger'),
    );
    expect(agentBody).not.toContain('toggleConfigure');
  });

  it('no page header ever renders Agent, and the generic PageHeader does not know about Configure', () => {
    expect(code(pageHeader)).not.toMatch(/Agent|Configure|useWorkspaceRail/);
  });

  it('every page that offers Configure also registers the panel it opens', () => {
    for (const area of ['resources', 'locations', 'customers', 'assets', 'work', 'schedule']) {
      const source = readFileSync(
        `${WEB}/app/organizations/[organizationId]/${area}/page.tsx`,
        'utf8',
      );
      expect(source, `${area}/page.tsx places ConfigureTrigger`).toContain('<ConfigureTrigger />');
      expect(source, `${area}/page.tsx registers its panel`).toContain('<ConfigureRegistrar');
    }
  });
});

describe('the Business phone header — compact controls wired to the right slots', () => {
  it('gives the context slot the compact context switcher and nothing else', () => {
    const contextBlock = organizationLayout.slice(
      organizationLayout.indexOf('context={'),
      organizationLayout.indexOf('beforeActions={'),
    );
    expect(contextBlock).toContain('CompactContextSwitcher');
    // The header carries no Setup treatment at any width: a phone reaches Setup through the
    // bottom bar's own lifecycle-aware first item (`SetupNavLink`), the sidebar through `SetupEntry`.
    expect(contextBlock).not.toMatch(/Setup/);
    expect(contextBlock).toContain('md:hidden');
  });

  it('gives beforeActions the compact account menu — Account sits before Agent, never after', () => {
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
    expect(contextBlock).toContain('organizations={switchable}');
    expect(organizationLayout).toMatch(/const switchable = myOrganizations\.map/);
    expect(contextBlock).not.toContain('platformStaff=');
    // Platform Administration is offered by the same server-resolved fact the sidebar's switcher gets.
    expect(contextBlock).toContain('platformAdministration={platformAdministration}');
  });
});

describe('the Platform route uses the unified workspace shell', () => {
  it('no longer lives beside generic header markup, and leaves every title to the page’s own PageHeader', () => {
    expect(existsSync(`${WEB}/components/site-header.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-header-title.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-header.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-shell.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/app/(platform)/platform/gold-bootstrap-form.tsx`)).toBe(false);
    // No pathname → title table — every Platform page renders its own PageHeader.
    expect(platformLayout).toContain('WorkspaceHeader');
    expect(platformLayout).toContain('PlatformSidebar');
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

  it('uses the shared workspace header for platform routes, with no title of its own', () => {
    expect(platformLayout).toContain('<WorkspaceHeader');
    expect(platformLayout).not.toMatch(/PlatformTrail|primary=|SiteHeader/);
  });

  it('keeps the two contexts’ navigation apart — neither shell inherits the other’s domain model', () => {
    expect(platformLayout).not.toMatch(/\bAREAS\b|areaLabel|areasIn\(/);
    expect(organizationLayout).not.toMatch(/PLATFORM_NAV|PlatformNavigation/);
    expect(orgShell).not.toMatch(/AreaTrail|PlatformTrail/);
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
      contextSwitcher.indexOf('<DropdownMenuSeparator />', contextSwitcher.indexOf('businesses.map')),
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

describe('the right rail — Agent and the page drawer are two independent, non-modal panels', () => {
  const pageDrawer = readFileSync(`${WEB}/components/containers/page-drawer.tsx`, 'utf8');
  const appShell = readFileSync(`${WEB}/components/containers/app-shell.tsx`, 'utf8');
  const workspaceGeometry = readFileSync(`${WEB}/components/containers/workspace-geometry.ts`, 'utf8');
  const configureRegistrar = readFileSync(`${WEB}/components/containers/configure-registrar.tsx`, 'utf8');

  it('keeps Agent and the page drawer open independently, both docked only where the screen has room', () => {
    expect(workspaceRightRail).toContain('const WIDE_BREAKPOINT = 1720');
    expect(workspaceRightRail).toContain('const DOCK_BREAKPOINT = 1280');
    expect(workspaceRightRail).toContain('const TABLET_BREAKPOINT = 768');
    expect(workspaceRightRail).toContain("const roomForBoth = layout === 'wide'");
    expect(workspaceRightRail).toMatch(/const \[agentOpen, setAgentOpen\]/);
    expect(workspaceRightRail).toMatch(/const \[configureOpen, setConfigureOpen\]/);
  });

  it('is never modal: no overlay, blur or focus trap, and the same two elements serve every layout', () => {
    const source = code(workspaceRightRail);
    expect(source).not.toMatch(/<Sheet|<Drawer|backdrop|Overlay/);
    expect(source).toContain('<AgentPanel />');
    expect(source).not.toContain('<PagePanel />');
    expect(source).toContain('<div className="min-w-0 flex-1">{main}</div>');
  });

  it('Agent is workspace-global: full height from the top, its header the workspace header\'s band', () => {
    const agentPanel = workspaceRightRail.slice(
      workspaceRightRail.indexOf('function AgentPanel'),
      workspaceRightRail.indexOf('/** Rendered by `AppShell`'),
    );
    expect(agentPanel).toContain("panelClass('agent'");
    expect(agentPanel).toContain('h-(--header-height)');
    expect(agentPanel).not.toMatch(/\bpy-3\b/);
    expect(workspaceRightRail).toContain("global ? 'sticky top-0 h-svh'");
  });

  it('the page panel is page-local: rendered by AppShell beneath the header, offset by the header height in every layout', () => {
    expect(code(appShell)).toContain('<PagePanel />');
    expect(appShell.indexOf('{header}')).toBeLessThan(appShell.indexOf('<PagePanel />'));
    expect(workspaceRightRail).toContain("sticky top-(--header-height) h-[calc(100svh-var(--header-height))]");
    expect(workspaceRightRail).toContain("global ? 'top-0' : 'top-(--header-height)'");
    expect(workspaceRightRail).toContain('calc(100dvh-var(--header-height))');
  });

  it('--header-height has one owner, the rail root, so both panels and the header read the same value', () => {
    expect(workspaceRightRail).toContain('style={HEADER_HEIGHT_STYLE}');
    expect(code(appShell)).not.toContain('--header-height');
    expect(workspaceGeometry).toContain("HEADER_HEIGHT = '3.5rem'");
  });

  it('a drawer header starts at the page\'s own top inset and its title row is the h1\'s height', () => {
    expect(code(appShell)).toContain('PAGE_PADDING');
    expect(code(pageDrawer)).toContain('PAGE_PADDING_TOP');
    expect(code(pageDrawer)).toContain('PAGE_TITLE_ROW');
    expect(code(pageDrawer)).toContain('PAGE_TOP_OFFSET');
    expect(workspaceGeometry).toContain("PAGE_PADDING = 'p-4 sm:p-6 lg:p-8'");
    expect(workspaceGeometry).toContain("PAGE_PADDING_TOP = 'pt-4 sm:pt-6 lg:pt-8'");
    expect(workspaceGeometry).toContain("PAGE_TOP_OFFSET = 'top-4 sm:top-6 lg:top-8'");
  });

  it('no page, feature or drawer positions itself against the header with its own offset', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (/\.tsx$/.test(entry.name) && /header-height/.test(readFileSync(`${dir}/${entry.name}`, 'utf8'))) {
          offenders.push(`${dir}/${entry.name}`.slice(WEB.length));
        }
      }
    };
    walk(`${WEB}/app`);
    walk(`${WEB}/features`);
    expect(offenders).toEqual([]);
  });

  it('every page drawer is a PageDrawer — no modal Sheet is left in a page or feature', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (/\.tsx$/.test(entry.name) && readFileSync(`${dir}/${entry.name}`, 'utf8').includes('@gold/ui/components/sheet')) {
          offenders.push(`${dir}/${entry.name}`.slice(WEB.length));
        }
      }
    };
    walk(`${WEB}/app`);
    walk(`${WEB}/features`);
    expect(offenders.filter((path) => !path.includes('marketing'))).toEqual([]);
  });

  it('PageDrawer portals into the host slot, sizes nothing itself and accepts no side or width', () => {
    expect(pageDrawer).toContain('createPortal');
    expect(pageDrawer).toContain('aria-modal="false"');
    expect(code(pageDrawer)).not.toMatch(/max-w-|max-h-|side=/);
  });

  it('Configure is a PageDrawer opened by ConfigureTrigger, closed when its page unmounts', () => {
    expect(configureRegistrar).toContain('<PageDrawer open={configureOpen}');
    expect(configureRegistrar).toContain('setConfigureOpen(false)');
  });
});


describe('the page-header contract — the page, not the workspace header, owns page identity', () => {
  it('the page-chrome registration mechanism is gone — nothing registers identity upward', () => {
    expect(existsSync(`${WEB}/components/containers/workspace-page-chrome.tsx`)).toBe(false);
    expect(workspaceShell).not.toContain('PageChrome');
    expect(recordHeader).not.toContain('useWorkspacePageChrome');
  });

  it('WorkspaceShell hosts the rail and shell only; a page renders its own header', () => {
    expect(workspaceShell).toContain('WorkspaceRailProvider');
    expect(code(workspaceShell)).not.toMatch(/PageHeader|<h1/);
  });

  it('PageHeader is one server-safe composition: one <h1>, description, meta, actions, and crumbs sent to the workspace bar', () => {
    expect(pageHeader).not.toContain("'use client'");
    expect(code(pageHeader).match(/<h1\b/g)).toHaveLength(1);
    expect(pageHeader).toContain('<PageCrumbs');
    expect(code(pageHeader)).not.toContain('<Breadcrumb');
    for (const prop of ['title', 'crumbs', 'description', 'meta', 'actions']) {
      expect(pageHeader, `PageHeader takes ${prop}`).toMatch(new RegExp(`\\b${prop}\\b`));
    }
  });

  it('PageHeader is presentation only — no domain, authorization or width knowledge', () => {
    expect(code(pageHeader)).not.toMatch(/organizationId|requireOrganization|requireActor|isPlatformStaff|capabilit/i);
    // The canvas — width and centring — is AppPage's; a description's own measure is not.
    expect(code(pageHeader)).not.toMatch(/mx-auto|max-w-screen|max-w-\[/);
  });

  it('RecordHeader keeps its historical props but renders PageHeader, dropping its own last crumb', () => {
    expect(recordHeader).toContain('<PageHeader');
    expect(recordHeader).toContain('crumbs.slice(0, -1)');
    expect(recordHeader).not.toContain('<h1');
  });

  it('every organization page renders exactly one page identity, and no route is left to the retired header trail', () => {
    const root = `${WEB}/app/organizations/[organizationId]`;
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (entry.name === 'page.tsx') pages.push(`${dir}/${entry.name}`);
      }
    };
    walk(root);
    expect(pages.length).toBeGreaterThan(20);

    // A page's identity is its PageHeader, a RecordHeader-based header component, or a feature
    // that renders one (Today, the customer record). A pure redirect renders nothing at all.
    const identity = /<PageHeader|<RecordHeader|<WorkRecordHeader|<CustomerDetail|<TodayDashboard/;
    for (const page of pages) {
      const source = readFileSync(page, 'utf8');
      const label = page.slice(root.length);
      // A pure redirect renders nothing, and so does an unmatched-address catch-all that only
      // throws `notFound()` so the segment's own `not-found.tsx` renders inside its layout.
      if ((/^\s*redirect\(/m.test(source) || /^\s*notFound\(\);/m.test(source)) && !identity.test(source)) continue;
      expect(source, `${label} renders no page identity`).toMatch(identity);
      expect(source, `${label} would render two <h1> elements`).not.toMatch(/<h1\b|<PageHeading/);
    }
  });
});

describe('Resources — the reference page for the workspace/page hierarchy', () => {
  const [beforeHeader, headerOnward] = [
    resourcesPage.slice(0, resourcesPage.indexOf('<PageHeader')),
    resourcesPage.slice(resourcesPage.indexOf('<PageHeader')),
  ];
  const headerBlock = headerOnward.slice(0, headerOnward.indexOf('/>\n', headerOnward.indexOf('actions=')));

  it('renders one PageHeader, titled from the navigation entry, inside AppPage', () => {
    expect(resourcesPage.match(/<PageHeader\b/g)).toHaveLength(1);
    expect(resourcesPage).toContain("title={areaLabel('resources')}");
    expect(resourcesPage.indexOf('<AppPage')).toBeLessThan(resourcesPage.indexOf('<PageHeader'));
    expect(resourcesPage).not.toContain('<h1');
    expect(resourcesPage).not.toContain('PageChromeRegistrar');
  });

  it('puts Add resource in the page-action area, after Configure — one primary action', () => {
    expect(headerBlock).toContain('<CreateResourceTrigger />');
    expect(headerBlock).toContain('<ConfigureTrigger />');
    expect(headerBlock.indexOf('<ConfigureTrigger')).toBeLessThan(headerBlock.indexOf('<CreateResourceTrigger'));
  });

  it('keeps its Configure panel registration and the create-sheet provider around the header', () => {
    expect(resourcesPage).toContain('<ConfigureRegistrar');
    expect(resourcesPage).toContain('title="Resources configuration"');
    expect(beforeHeader).toContain('<CreateResourceSheetProvider');
  });

  it('does not repeat the Add trigger in the empty state — the header already offers it', () => {
    expect(resourcesPage).not.toContain('emptyAction=');
  });

  it('still hides controls by capability as courtesy only — the guard stays in the database', () => {
    expect(resourcesPage).toContain("'resource.create'");
    expect(resourcesPage).toContain("'field.manage'");
  });
});

describe('Business area roots with an Add action keep it in their PageHeader', () => {
  it('Resources, Locations, Customers and Assets no longer render PageHeading or register chrome', () => {
    for (const area of ['resources', 'locations', 'customers', 'assets']) {
      const source = readFileSync(
        `${WEB}/app/organizations/[organizationId]/${area}/page.tsx`,
        'utf8',
      );
      expect(source, `${area}/page.tsx should not import PageHeading`).not.toContain('PageHeading');
      expect(source, `${area}/page.tsx should render PageHeader`).toContain('<PageHeader');
    }
  });

  it('each area’s primary "Add" action sits in the PageHeader actions, not a body header row', () => {
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
      const start = source.indexOf('<PageHeader');
      const header = source.slice(start, source.indexOf('\n        />', start));
      expect(header, `${area}/page.tsx should place ${trigger} in PageHeader actions`).toContain(trigger);
    }
  });
});

describe('Platform pages render their own PageHeader', () => {
  it('the Catalog and Overview pages render PageHeader and no PageHeading', () => {
    expect(platformCatalogPage).not.toContain('PageHeading');
    expect(platformCatalogPage).toContain('<PageHeader');
    expect(platformOverview).not.toContain('PageHeading');
    expect(platformOverview).toContain('<PageHeader');
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
  it('renders a PageHeader instead of an sr-only heading plus the retired override store', () => {
    expect(tenantWorkspace).toContain('<PageHeader');
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

describe('Personal settings shares the authenticated shell — no standalone island', () => {
  const shell = readFileSync(`${WEB}/features/account/personal-settings-shell.tsx`, 'utf8');
  const contextSwitcherSource = readFileSync(`${WEB}/components/containers/context-switcher.tsx`, 'utf8');
  const sidebar = readFileSync(`${WEB}/features/account/personal-settings-sidebar.tsx`, 'utf8');
  const profile = readFileSync(`${WEB}/app/settings/account/page.tsx`, 'utf8');
  const security = readFileSync(`${WEB}/app/settings/account/security/page.tsx`, 'utf8');

  it('mounts WorkspaceShell inside the shared Settings frame rather than a bare <main>', () => {
    expect(shell).toContain('<WorkspaceShell');
    expect(shell).toContain('<SettingsPageFrame>');
    expect(shell).not.toMatch(/<main\b/);
  });

  it('every page names itself with one PageHeader, not a title in the global header', () => {
    for (const page of [profile, security]) {
      expect(page).toContain('<PageHeader');
      expect(page).toContain('<PersonalSettingsShell');
      expect(page).not.toContain('primary=');
    }
  });

  it('registers an Agent rail — every workspace keeps Agent as a furthest-right control', () => {
    expect(shell).toContain('AccountAgentRail');
  });

  it('has its own SwitcherContext kind, rather than borrowing "business" or "platform"', () => {
    expect(contextSwitcherSource).toMatch(/\{\s*kind:\s*'account'\s*\}/);
    expect(sidebar).toContain("kind: 'account'");
  });

  it('keeps ContextSwitcher as the only cross-context navigation, and lists personal sections only', () => {
    expect(sidebar).toContain('ContextSwitcher');
    expect(sidebar).toContain('PERSONAL_SECTIONS');
    expect(sidebar).not.toContain('PlatformNavigation');
    expect(sidebar).not.toMatch(/AREAS|areasIn\(/);
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
    const uiRoot = fileURLToPath(new URL('../../../../../packages/ui/src/components', import.meta.url));
    expect(existsSync(`${uiRoot}/drawer.tsx`)).toBe(true);
    expect(existsSync(`${WEB}/components/ui/drawer.tsx`)).toBe(false);
  });
});
