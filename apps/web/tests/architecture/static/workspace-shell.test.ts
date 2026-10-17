import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

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

it('page drawer actions stay outside scrolling forms', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(file); continue; }
      if (!file.endsWith('.tsx')) continue;
      const source = readFileSync(file, 'utf8');
      if (!source.includes('<PageDrawerFooter')) continue;
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'PageDrawerFooter') {
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (!ts.isJsxElement(parent)) continue;
            const tag = parent.openingElement.tagName.getText(tree);
            if (tag === 'PageDrawerContent') break;
            if (tag === 'form') {
              const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
              offenders.push(`${file.slice(WEB.length)}:${line}`);
              break;
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  };
  walk(`${WEB}/features`);
  walk(`${WEB}/app`);
  expect(offenders).toEqual([]);
});

// Doc comments legitimately name what a file does not do; only the code is under test.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const workspaceHeader = readFileSync(`${WEB}/components/headers/workspace-header.tsx`, 'utf8');
const workspaceRightRail = readFileSync(`${WEB}/components/panels/workspace-right-rail.tsx`, 'utf8');
const contextSwitcher = readFileSync(`${WEB}/components/navigation/context-switcher.tsx`, 'utf8');
const accountMenu = readFileSync(`${WEB}/components/navigation/account-menu.tsx`, 'utf8');
// The shell every organization page renders in — Platform included, which is a sub-scope of GOLD's own organization.
const organizationLayout = readFileSync(`${WEB}/features/shell/organization-shell.tsx`, 'utf8') + readFileSync(`${WEB}/app/organizations/[organizationId]/org-shell.tsx`, 'utf8');
// Phase C's application layer (Slice 9/12): the shell's own reads — switchable organizations,
// Business settings' offer, feature/platform resolution — were moved out of the layout component
// into one coordinating function the layout merely calls and destructures.
const organizationShellModel = readFileSync(`${WEB}/lib/application/shell/organization-shell.ts`, 'utf8');
const organizationLayoutRoute = readFileSync(`${WEB}/app/organizations/[organizationId]/layout.tsx`, 'utf8');
const platformLayout = readFileSync(`${WEB}/app/organizations/[organizationId]/platform/layout.tsx`, 'utf8');
const legacyPlatformEntry = readFileSync(`${WEB}/app/platform/[[...path]]/page.tsx`, 'utf8');
const workspaceShell = readFileSync(`${WEB}/components/layout/workspace-shell.tsx`, 'utf8');
const pageHeader = readFileSync(`${WEB}/components/headers/page-header.tsx`, 'utf8');
const orgShell = readFileSync(`${WEB}/app/organizations/[organizationId]/org-shell.tsx`, 'utf8');
const resourcesPage = readFileSync(
  `${WEB}/app/organizations/[organizationId]/resources/page.tsx`,
  'utf8',
);
const recordHeader = readFileSync(`${WEB}/components/headers/record-header.tsx`, 'utf8');
const platformNavigation = readFileSync(`${WEB}/lib/platform-navigation.ts`, 'utf8');
const shellProjection = readFileSync(`${WEB}/lib/shell.ts`, 'utf8');
const tenantWorkspace = readFileSync(`${WEB}/features/platform/tenant-workspace.tsx`, 'utf8');
const platformOrganizationOverview = readFileSync(
  `${WEB}/app/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/page.tsx`,
  'utf8',
);
const platformCatalogPage = readFileSync(`${WEB}/app/organizations/[organizationId]/platform/catalog/page.tsx`, 'utf8');
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

  it('carries the trigger, context, breadcrumbs, before-actions and Agent slots', () => {
    for (const token of ['SidebarTrigger', '{context}', '<WorkspaceCrumbSlot', '{beforeActions}', '<AgentTrigger']) {
      expect(workspaceHeader, `expected to find "${token}" in workspace-header.tsx`).toContain(token);
    }
  });

  it('exposes Agent as a workspace-global control, and no Configure', () => {
    expect(workspaceHeader).toContain('<AgentTrigger />');
    expect(code(workspaceHeader)).not.toMatch(/Configure|Settings/);
  });
});

describe('Agent is workspace-global and the support modes are page-level', () => {
  it('AgentTrigger is the rail\'s global Agent control, labelled and pressed-state aware', () => {
    expect(workspaceRightRail).toContain('export function AgentTrigger');
    expect(workspaceRightRail).toContain('aria-label="Agent"');
    expect(workspaceRightRail).toContain('aria-pressed={agentOpen}');
  });

  it('SupportTrigger is a separate export a page header places, with pressed state per mode', () => {
    expect(workspaceRightRail).toContain('export function SupportTrigger');
    expect(workspaceRightRail).toContain('aria-pressed={supportMode === mode}');
    const agentBody = workspaceRightRail.slice(
      workspaceRightRail.indexOf('export function AgentTrigger'),
      workspaceRightRail.indexOf('export function SupportTrigger'),
    );
    expect(agentBody).not.toContain('toggleSupport');
  });

  it('holds one support mode at a time, so switching reuses the rail rather than stacking drawers', () => {
    expect(workspaceRightRail).toContain("export const SUPPORT_MODES = ['activity', 'insights', 'configure'] as const");
    expect(workspaceRightRail).toMatch(/const \[supportMode, setSupportMode\] = useState<SupportMode \| null>/);
    // No second open-state per mode: the three drawers are one value compared to their own mode.
    expect(workspaceRightRail).not.toMatch(/activityOpen|insightsOpen|configureOpen/);
    const registrar = readFileSync(`${WEB}/components/panels/support-registrar.tsx`, 'utf8');
    expect(registrar).toContain('<PageDrawer open={supportMode === mode}');
    // Closing on unmount is scoped to this registrar's own mode.
    expect(registrar).toContain('current === mode ? null : current');
  });

  it('Agent stays a separate workspace-global panel beside the one page-support rail', () => {
    expect(workspaceRightRail).toContain("type Panel = 'agent' | 'page'");
    expect(workspaceRightRail).toContain('<AgentPanel />');
    expect(code(pageHeader)).not.toMatch(/AgentTrigger|toggleAgent/);
  });

  it('no page header ever renders Agent, and PageHeader offers the support modes after the page actions', () => {
    expect(code(pageHeader)).not.toMatch(/Agent|useWorkspaceRail/);
    const header = code(pageHeader);
    for (const mode of ['activity', 'insights', 'configure']) {
      expect(header.indexOf(`<SupportTrigger mode="${mode}" />`)).toBeGreaterThan(header.indexOf('{actions}'));
    }
  });

  it('only offers a mode where the page also registers its content', () => {
    const root = `${WEB}/app/organizations/[organizationId]`;
    for (const area of ['customers', 'work']) {
      const source = readFileSync(`${root}/${area}/page.tsx`, 'utf8');
      expect(source, `${area} offers Activity`).toMatch(/\bactivity\b/);
      expect(source, `${area} registers Activity`).toContain('<SupportRegistrar mode="activity"');
      expect(source, `${area} offers Insights`).toContain('insights={mayInsight &&');
      expect(source, `${area} registers Insights`).toMatch(/<SupportRegistrar\s+mode="insights"/);
      expect(source, `${area} requires report access`).toContain(
        area === 'work' ? "can('report.read')" : "organization.capabilities.includes('report.read')",
      );
      expect(source).not.toContain('/insights/reports');
      expect(source).not.toContain('hrefLabel="Full report"');
      expect(source, `${area} gates Insights on the reporting workspace`).toMatch(/areaAvailable\('insights'/);
    }
    // Activity reads only through the timeline's named scopes; a page never names event actions.
    for (const path of ['features/timeline/workspace-activity.tsx', 'features/insights/workspace-insights.tsx']) {
      const source = readFileSync(`${WEB}/${path}`, 'utf8');
      expect(source).not.toMatch(/\.from\('events'\)|customer\.created|work_item\./);
    }
    const insights = readFileSync(`${WEB}/features/insights/workspace-insights.tsx`, 'utf8');
    // The rail reuses the reporting aggregates; it computes no total of its own.
    expect(insights).toContain('listWorkMarkedComplete');
    expect(insights).toContain('listInvoicedAndIncurred');
    expect(insights).not.toMatch(/\.reduce\(/);
  });

  it('Finance offers no global Insights link', () => {
    const finance = readFileSync(`${WEB}/app/organizations/[organizationId]/finance/page.tsx`, 'utf8');
    expect(finance).not.toContain('Financial insights');
    expect(finance).not.toContain('/insights');
    expect(finance).not.toContain("areaHref(organizationId, 'insights')");
  });

  it('every page that offers Configure also registers the panel it opens', () => {
    for (const area of ['resources', 'locations', 'assets', 'schedule', 'customers', 'work']) {
      const source = readFileSync(
        `${WEB}/app/organizations/[organizationId]/${area}/page.tsx`,
        'utf8',
      );
      expect(source, `${area}/page.tsx asks for Configure`).toMatch(/configure=\{mayConfigure\}/);
      expect(source, `${area}/page.tsx registers its panel`).toContain('<ConfigureRegistrar');
      expect(source).not.toContain('configure={mayConfigure && types.length > 0}');
      expect(source).not.toContain('configure={mayConfigure && !emptyCollection}');
      if (area === 'work') expect(source).toMatch(/\{mayConfigure \? \(\s*<ConfigureRegistrar/);
    }
  });
});

describe('the Business mobile navigation', () => {
  it('uses the header trigger and no bottom bar or compact header switcher', () => {
    expect(organizationLayout).toContain('navigationTrigger="always"');
    expect(organizationLayout).not.toContain('CompactContextSwitcher');
    expect(organizationLayout).not.toContain('bottomBar=');
    expect(organizationLayout).not.toContain('beforeActions=');
  });
  it('reuses authorized switcher choices and keeps recovery mobile identity inert', () => {
    expect(organizationShellModel).toMatch(/myOrganizations\.map/);
    const restricted = orgShell.slice(orgShell.indexOf('export function LockedOrgSidebar'), orgShell.indexOf('export function OrganizationFrame'));
    expect(restricted).toContain('<ContextIdentity');
    expect(restricted).toContain('hidden md:block');
  });
});

describe('the Platform route renders inside the one organization shell', () => {
  it('no longer lives beside generic header markup, and leaves every title to the page’s own PageHeader', () => {
    expect(existsSync(`${WEB}/components/site-header.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-header-title.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-header.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-shell.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/features/platform/platform-navigation.tsx`)).toBe(false);
    expect(existsSync(`${WEB}/app/(platform)`)).toBe(false);
    // Frame and header are the organization layout's; the platform layout beneath it is only the door.
    expect(organizationLayoutRoute).toContain('<OrganizationShell');
    expect(platformLayout).not.toMatch(/OrganizationShell|WorkspaceHeader|WorkspaceShell|PlatformSidebar|PlatformNavBar/);
  });

  it('does not expose GOLD bootstrap as product UI', () => {
    expect(platformLayout).not.toContain('GoldBootstrapForm');
    expect(platformLayout).not.toContain('bootstrapAction');
    expect(platformLayout).not.toContain('GOLD operating workspace must be initialized');
    expect(platformLayout).not.toContain('GOLD organization ID');
    expect(platformLayout).not.toContain('Initialize GOLD workspace');
  });

  it('fails a missing operating organization as server configuration, without a UUID form', () => {
    // Nested Platform routes refuse any other organization with notFound(); the one place that can
    // say the operating organization is missing is the legacy entry, which has no route parameter.
    expect(legacyPlatformEntry).toContain('operating_organization.configuration_required');
    expect(legacyPlatformEntry).toContain('console.error');
    expect(legacyPlatformEntry).toContain('membershipOrganizationIds');
    expect(legacyPlatformEntry).not.toContain('<form');
  });

  it('gets its trigger and switcher from the one shell, at every width', () => {
    expect(organizationLayout).toContain('navigationTrigger="always"');
    expect(organizationLayout).toContain('<ContextSwitcher');
    expect(organizationLayout).not.toContain('bottomBar=');
  });

  it('keeps platform navigation out of the area registry — one projection combines them', () => {
    expect(platformNavigation).not.toMatch(/AREAS|areaLabel|areasIn\(/);
    expect(organizationLayout).not.toMatch(/PLATFORM_NAV|PlatformNavigation/);
    expect(orgShell).not.toMatch(/AreaTrail|PlatformTrail/);
  });
});

describe('ContextSwitcher — content is about context only', () => {
  it('offers neither Organization settings, Personal settings nor Sign out — those are the account menu\'s job', () => {
    const executable = contextSwitcher.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(executable).not.toMatch(/Organization settings|Personal settings|Sign out|signOutAction/);
  });

  it('shows each business row’s role as secondary text', () => {
    const businessesBlock = contextSwitcher.slice(
      contextSwitcher.indexOf('businesses.map'),
      contextSwitcher.indexOf('<DropdownMenuSeparator />', contextSwitcher.indexOf('businesses.map')),
    );
    expect(businessesBlock).toContain('organization.role');
  });

  it('shares one menu-content implementation between the sidebar trigger and the compact trigger, and offers no combined operator menu', () => {
    expect(contextSwitcher).toContain('function ContextSwitcherMenuContent');
    expect(contextSwitcher.match(/<DropdownMenuContent/g)?.length).toBe(1);
    expect(contextSwitcher).toContain('export function ContextSwitcher(');
    expect(contextSwitcher).toContain('export function CompactContextSwitcher(');
    expect(contextSwitcher).not.toContain('export function CompactOperatorMenu(');
  });

  it('does not render a role beneath the business name in either trigger — role stays inside the opened menu', () => {
    const triggers = contextSwitcher.slice(contextSwitcher.indexOf('export function ContextSwitcher('), contextSwitcher.indexOf('export function ContextIdentity('));
    expect(triggers).not.toMatch(/triggerRole/);
  });
});

describe('AccountMenu — one trigger, in the sidebar footer', () => {
  it("is the sidebar footer's menu only: a phone reaches it through the Menu sheet", () => {
    expect(accountMenu).toContain('function AccountMenuContent');
    expect(accountMenu.match(/<DropdownMenuContent/g)?.length).toBe(1);
    expect(accountMenu).not.toContain('CompactAccountMenu');
  });
});

describe('the right rail — Agent and the page drawer are independent panels', () => {
  const pageDrawer = readFileSync(`${WEB}/components/panels/page-drawer.tsx`, 'utf8');
  const appShell = readFileSync(`${WEB}/components/layout/app-shell.tsx`, 'utf8');
  const workspaceGeometry = readFileSync(`${WEB}/components/layout/workspace-geometry.ts`, 'utf8');
  const configureRegistrar = readFileSync(`${WEB}/components/panels/configure-registrar.tsx`, 'utf8');

  it('keeps Agent and the page drawer open independently, both docked only where the screen has room', () => {
    expect(workspaceRightRail).toContain('const WIDE_BREAKPOINT = 1720');
    expect(workspaceRightRail).toContain('const DOCK_BREAKPOINT = 1280');
    expect(workspaceRightRail).toContain('const TABLET_BREAKPOINT = 768');
    expect(workspaceRightRail).toContain("const roomForBoth = layout === 'wide'");
    expect(workspaceRightRail).toMatch(/const \[agentOpen, setAgentOpen\]/);
    expect(workspaceRightRail).toMatch(/const \[supportMode, setSupportMode\]/);
  });

  it('keeps one Agent across layouts, with phone-only native modal behavior and nonmodal page panels', () => {
    const source = code(workspaceRightRail);
    expect(source).not.toMatch(/<Sheet|<Drawer|<DialogContent/);
    expect(source).toContain('dialog.showModal()');
    expect(source).toContain('phone && showAgent');
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
    expect(workspaceRightRail).toContain("global ? 'top-0 left-auto h-dvh' : 'top-(--header-height)'");
    expect(workspaceRightRail).toContain('calc(100dvh-var(--header-height))');
  });

  it('--header-height has one owner, the rail root, so both panels and the header read the same value', () => {
    expect(workspaceRightRail).toContain('style={HEADER_HEIGHT_STYLE}');
    expect(code(appShell)).not.toContain('--header-height');
    expect(workspaceGeometry).toContain("HEADER_HEIGHT = '3.5rem'");
  });

  it('a drawer header is one compact band read from the shared tokens, thinner than the workspace header', () => {
    expect(code(appShell)).toContain('PAGE_PADDING');
    expect(code(pageDrawer)).toContain('DRAWER_HEADER');
    expect(code(pageDrawer)).toContain('DRAWER_CLOSE_OFFSET');
    expect(workspaceGeometry).toContain("PAGE_PADDING = 'p-4 sm:p-6 lg:p-8'");
    expect(workspaceGeometry).toContain("DRAWER_HEADER = 'min-h-12 py-2 pl-4 pr-14'");
    expect(workspaceGeometry).toContain("DRAWER_CLOSE_OFFSET = 'top-2'");
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

  it('Configure is the configure mode of the one support rail, closed when its page unmounts', () => {
    expect(configureRegistrar).toContain('<SupportRegistrar mode="configure"');
    const registrar = readFileSync(`${WEB}/components/panels/support-registrar.tsx`, 'utf8');
    expect(registrar).toContain('setSupportMode((current) => (current === mode ? null : current))');
  });
});


describe('the page-header contract — the page, not the workspace header, owns page identity', () => {
  it('the page-chrome registration mechanism is gone — nothing registers identity upward', () => {
    expect(existsSync(`${WEB}/components/layout/workspace-page-chrome.tsx`)).toBe(false);
    expect(workspaceShell).not.toContain('PageChrome');
    expect(recordHeader).not.toContain('useWorkspacePageChrome');
  });

  it('WorkspaceShell hosts the rail and shell only; a page renders its own header', () => {
    expect(workspaceShell).toContain('WorkspaceRailProvider');
    expect(code(workspaceShell)).not.toMatch(/PageHeader|<h1/);
  });

  it('PageHeader is one server-safe composition: one <h1>, meta, actions, and a published location — and no generic description', () => {
    expect(pageHeader).not.toContain("'use client'");
    expect(code(pageHeader).match(/<h1\b/g)).toHaveLength(1);
    expect(pageHeader).toContain('<PageLocation');
    expect(code(pageHeader)).not.toContain('<Breadcrumb');
    for (const prop of ['title', 'crumbs', 'meta', 'actions']) {
      expect(pageHeader, `PageHeader takes ${prop}`).toMatch(new RegExp(`\\b${prop}\\b`));
    }
    expect(code(pageHeader), 'PageHeader no longer takes a generic description').not.toMatch(/\bdescription\b/);
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

    // A page's identity is PageHeader or one of the Phase B screen patterns (CollectionHeader,
    // WorkspaceHome, StatePage), a RecordHeader-based header component, or a feature that renders
    // one (Home, the customer record). A pure redirect renders nothing at all.
    // Phase C's loader+Screen route pairs (Slice 9) put the identity component one file down, in
    // the Screen the page delegates to, rather than inline in the page itself — the same shape
    // `CustomerDetail`/`HomeDashboard` already had: a feature component that renders the real one.
    const identity = /<PageHeader|<CollectionHeader|<WorkspaceHome|<StatePage|<RecordHeader|<WorkRecordHeader|<CustomerDetail|<CrmHome|<HomeDashboard|<TenantWorkspaceHeader|<PlatformOverview|<LibrarySectionPage|<AccessPage|<ConnectionsPage|<PlanDetailScreen|<OrganizationCommercialScreen|<CatalogFamilyScreen|<TwilioProviderScreen|<PlanUsageScreen|<WorkItemDetailScreen|<StudioHome|<MarketingPage|<AgentWorkbench|<AiWorkspace/;
    // A master-detail screen (the Inbox: a persistent list beside whichever pane is selected) renders its one
    // identity in the layout that frames every pane, because a page-owned header would be torn down and drawn
    // again on every selection. Only a layout *below* the organization root counts — the root layout frames
    // everything and would excuse every page.
    const framedByIdentity = (page: string): boolean => {
      let dir = page.slice(0, page.lastIndexOf('/'));
      while (dir.length > root.length) {
        try {
          if (identity.test(readFileSync(`${dir}/layout.tsx`, 'utf8'))) return true;
        } catch {
          // no layout at this level
        }
        dir = dir.slice(0, dir.lastIndexOf('/'));
      }
      return false;
    };
    for (const page of pages) {
      if (framedByIdentity(page)) continue;
      const source = readFileSync(page, 'utf8');
      const label = page.slice(root.length);
      // A pure redirect renders nothing, and so does an unmatched-address catch-all that only
      // throws `notFound()` so the segment's own `not-found.tsx` renders inside its layout.
      if ((/^\s*redirect\(/m.test(source) || /^\s*notFound\(\);/m.test(source)) && !identity.test(source)) continue;
      // A thin page may delegate to a loader and then the feature screen that draws the header; follow imports two files deep.
      const draws = (text: string, depth: number): boolean => {
        if (identity.test(text)) return true;
        if (depth === 0) return false;
        const targets = [...text.matchAll(/from ['"]@\/((?:features|lib\/application)\/[^'"]+)['"]/g)].map((match) => match[1]);
        return targets.some((target) =>
          ['.tsx', '/index.tsx'].some((ext) => {
            try { return draws(readFileSync(`${WEB}/${target}${ext}`, 'utf8'), depth - 1); } catch { return false; }
          }));
      };
      const oneHop = draws(source, 2);
      expect(identity.test(source) || oneHop, `${label} renders no page identity`).toBe(true);
      expect(source, `${label} would render two <h1> elements`).not.toMatch(/<h1\b|<PageHeading/);
    }
  });
});

describe('Resources — the reference page for the workspace/page hierarchy', () => {
  const [beforeHeader, headerOnward] = [
    resourcesPage.slice(0, resourcesPage.indexOf('<CollectionHeader')),
    resourcesPage.slice(resourcesPage.indexOf('<CollectionHeader')),
  ];
  const headerBlock = headerOnward.slice(0, headerOnward.indexOf('/>\n', headerOnward.indexOf('actions=')));

  it('renders one CollectionHeader, titled from the navigation entry, inside AppPage', () => {
    expect(resourcesPage.match(/<CollectionHeader\b/g)).toHaveLength(1);
    expect(resourcesPage).toContain("title={areaLabel('resources')}");
    expect(resourcesPage.indexOf('<AppPage')).toBeLessThan(resourcesPage.indexOf('<CollectionHeader'));
    expect(resourcesPage).not.toContain('<h1');
    expect(resourcesPage).not.toContain('PageChromeRegistrar');
  });

  it('offers Add resource as a page action, alongside Configure', () => {
    expect(headerBlock).toContain('<CreateResourceTrigger />');
    expect(headerBlock).toContain('configure={mayConfigure}');
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

describe('Business area roots with an Add action keep it in their CollectionHeader', () => {
  it('Resources, Locations, Customers and Assets no longer render PageHeading or register chrome', () => {
    for (const area of ['resources', 'locations', 'customers', 'assets']) {
      const source = readFileSync(
        `${WEB}/app/organizations/[organizationId]/${area}/page.tsx`,
        'utf8',
      );
      expect(source, `${area}/page.tsx should not import PageHeading`).not.toContain('PageHeading');
      expect(source, `${area}/page.tsx should render CollectionHeader`).toContain('<CollectionHeader');
    }
  });

  it('each area’s primary "Add" action sits in the CollectionHeader actions, not a body header row', () => {
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
      const start = source.indexOf('<CollectionHeader');
      const header = source.slice(start, source.indexOf('\n        />', start));
      expect(header, `${area}/page.tsx should place ${trigger} in CollectionHeader actions`).toContain(trigger);
    }
  });
});

describe('Platform pages render their own page identity', () => {
  it('the Catalog page renders PageHeader and the Overview page renders WorkspaceHome, neither a PageHeading', () => {
    expect(platformCatalogPage).not.toContain('PageHeading');
    expect(platformCatalogPage).toContain('<PageHeader');
    expect(platformOverview).not.toContain('PageHeading');
    expect(platformOverview).toContain('<WorkspaceHome');
  });

  it('the legacy flat SKU list reads as "Line items" under Catalog, never a second "Products"', () => {
    const productsPage = readFileSync(
      `${WEB}/app/organizations/[organizationId]/platform/catalog/products/page.tsx`,
      'utf8',
    );
    expect(productsPage).toContain("title=\"Line items\"");
    // The nav's Products is the catalogue landing (the Gild Products), a different page from that list.
    expect(platformNavigation).toContain("label: 'Products', path: 'catalog'");
  });
});

describe('Platform navigation highlights the most specific matching item, never two at once', () => {
  it('names the catalogue landing Products, under the Product Registry heading — the legacy line-item list is one level in', () => {
    expect(platformNavigation).toContain("label: 'Products', path: 'catalog'");
    expect(platformNavigation).toContain("{ key: 'product-registry', label: 'Product Registry' }");
  });

  it('picks the longest matching href so a Plan or Product detail route activates its own section', () => {
    expect(shellProjection).toContain('export function activeItemKey');
    // `>=`, so a page beats a parent that shares its address (a Platform group opens its first page).
    expect(shellProjection).toContain('href.length >= bestLength');
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
    // Never a fabricated tenant capability inside /platform (ADR-003) — the gate is the
    // caller's own listMyOrganizations() result, resolved server-side, not staff authority.
    expect(platformOrganizationOverview).toContain('listMyOrganizations');
    expect(platformOrganizationOverview).toMatch(
      /myOrganizations\.some\(\(organization\) => organization\.id === organizationId\)/,
    );
  });
});

describe('Personal settings shares the authenticated shell — no standalone island', () => {
  const shell = readFileSync(`${WEB}/features/account/personal-settings-shell.tsx`, 'utf8');
  const profile = readFileSync(`${WEB}/app/settings/account/page.tsx`, 'utf8');
  const security = readFileSync(`${WEB}/app/settings/account/security/page.tsx`, 'utf8');

  // The invariant: changing configuration scope must not create an unrelated application shell.
  it('builds no shell of its own: it renders inside the business shell, or the account-only frame', () => {
    expect(shell).toContain('<OrganizationShell');
    expect(shell).toContain('<GlobalFallbackShell');
    expect(shell).not.toMatch(/<WorkspaceShell|<Sidebar|WorkspaceHeader/);
    expect(existsSync(`${WEB}/features/account/personal-settings-sidebar.tsx`)).toBe(false);
  });

  it('puts the page inside the shared Settings frame rather than a bare <main>', () => {
    expect(shell).toContain('<SettingsPageFrame>');
    expect(shell).not.toMatch(/<main/);
  });

  it('every page names itself with one PageHeader, not a title in the global header', () => {
    for (const page of [profile, security]) {
      expect(page).toContain('<SettingsPageHeader');
      expect(page).toContain('<PersonalSettingsShell');
      expect(page).not.toContain('primary=');
    }
  });

  it('leaves the Agent rail to whichever shell it sits in', () => {
    expect(shell).not.toContain('AccountAgentRail');
  });

  it('has no SwitcherContext of its own: the switcher names a business or the platform', () => {
    expect(readFileSync(`${WEB}/components/navigation/context-switcher.tsx`, 'utf8')).not.toMatch(/kind:s*'account'/);
  });
});

describe('the Catalog family grid uses the shared Progress primitive, not a hand-built bar', () => {
  it('imports Progress from packages/ui rather than a styled div pair', () => {
    const catalogPage = readFileSync(`${WEB}/app/organizations/[organizationId]/platform/catalog/page.tsx`, 'utf8');
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

describe('organization page composition', () => {
  const listSource = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return listSource(path);
      return /\.tsx$/.test(entry.name) ? [path] : [];
    });
  const sources = ['app', 'features', 'components'].flatMap((root) => listSource(`${WEB}/${root}`));
  const read = (path: string) => readFileSync(path, 'utf8');

  it('AppPage is the one frame: fluid by default, and no page names a width of its own', () => {
    const appPage = read(`${WEB}/components/layout/app-page.tsx`);
    expect(code(appPage)).toContain("width = 'fluid'");
    expect(code(appPage)).not.toMatch(/max-w-\[|max-w-screen|max-w-none/);
    const offenders = sources
      .filter((path) => path.includes('organizations') || path.includes('features'))
      .filter((path) => /<AppPage[^>]*width="(wide|full|standard)"/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('a page never places a support mode: only a screen pattern renders one, after the business actions', () => {
    const renderers = sources.filter((path) => /<SupportTrigger\b/.test(read(path)));
    expect(renderers.map((path) => path.slice(WEB.length)).sort()).toEqual(
      ['/components/headers/page-header.tsx', '/components/patterns/collection-header.tsx', '/components/patterns/workspace-home.tsx'].sort(),
    );
    const header = code(read(`${WEB}/components/headers/page-header.tsx`));
    expect(header.indexOf('{actions}')).toBeGreaterThan(-1);
    expect(header.indexOf('{actions}')).toBeLessThan(header.indexOf('<SupportTrigger mode="activity" />'));
  });

  it('Import is offered by the organization capability, not by the module alone or by platform role', () => {
    const customers = read(`${WEB}/app/organizations/[organizationId]/customers/page.tsx`);
    expect(customers).toContain("organization.capabilities.includes('integration.manage')");
    expect(customers).not.toMatch(/staff/i);
    const newImport = read(
      `${WEB}/app/organizations/[organizationId]/library/imports/new/page.tsx`,
    );
    expect(newImport).toContain("organization.capabilities.includes('integration.manage')");
    expect(newImport.indexOf('integration.manage')).toBeLessThan(newImport.indexOf('await downloadImportFile'));
  });
});

describe('the sidebar draws the selected application context', () => {
  const orgShell = readFileSync(`${WEB}/app/organizations/[organizationId]/org-shell.tsx`, 'utf8');

  it('draws Administration as projected sections, never a pinned block of its own', () => {
    expect(orgShell).not.toContain('ADMINISTRATION_SECTIONS');
    expect(orgShell).toContain('navigation.map((section) => group(section))');
    expect(orgShell).not.toMatch(/absolute|fixed bottom|top-\[/);
  });

  it('keeps Plan & usage in the locked-organization sidebar only: recovery, not a Business shortcut', () => {
    const locked = orgShell.slice(orgShell.indexOf('export function LockedOrgSidebar'));
    expect(locked).toContain('/settings/plan');
    expect(locked).toContain('Plan &amp; usage');
    const operating = orgShell.slice(0, orgShell.indexOf('export function LockedOrgSidebar'));
    expect(operating).not.toMatch(/BUSINESS_ITEMS|section.key === 'business'/);
  });

  it('offers Administration from GildOps’ own navigation only — never the switcher or the account menu', () => {
    expect(contextSwitcher).not.toMatch(/platform\.href|PlatformContext|kind: 'platform'|System control plane|isOwner|isAdmin|platformPermissions|email\s*===/);
    expect(accountMenu.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/platform\.href|PlatformContext|<span>Platform|Administration/);
    expect(orgShell).not.toMatch(/GildOps Platform|System control plane|selectShellContext|GOLD_MARK/);
    expect(existsSync(`${WEB}/components/navigation/sidebar-footer-navigation.tsx`)).toBe(false);
  });
});

describe('the breadcrumb contract — every page publishes a location, ancestors + current', () => {
  const workspaceCrumbs = readFileSync(`${WEB}/components/navigation/workspace-crumbs.tsx`, 'utf8');
  const navigationSource = readFileSync(`${WEB}/lib/navigation.ts`, 'utf8');
  const platformNavigationSource = readFileSync(`${WEB}/lib/platform-navigation.ts`, 'utf8');

  it('WorkspaceHeader exposes exactly one breadcrumb slot, and it is the crumb portal target', () => {
    expect(workspaceHeader.match(/<WorkspaceCrumbSlot/g)).toHaveLength(1);
    expect(workspaceCrumbs).toContain('export function WorkspaceCrumbSlot()');
  });

  it('PageHeader always publishes a trail through PageLocation — no length guard stands between crumbs and the portal', () => {
    const source = code(pageHeader);
    // The historical guard this slice removes: rendering the location only when ancestors exist.
    expect(source).not.toMatch(/crumbs\s*&&\s*crumbs\.length/);
    expect(source).not.toMatch(/crumbs\.length === 0\s*\?\s*null/);
    expect(source).toContain('<PageLocation crumbs={section ? [] : crumbs} current={section ?? breadcrumbLabel ?? title} />');
  });

  it('PageLocation composes PageCrumbs and nothing else — no visible chrome of its own', () => {
    const pageLocation = code(readFileSync(`${WEB}/components/navigation/page-location.tsx`, 'utf8'));
    expect(pageLocation).toContain('<PageCrumbs crumbs={crumbs ?? []} current={current} />');
    expect(pageLocation).not.toMatch(/<h1|className=/);
  });

  it('PageCrumbs takes a required `current` and always renders once mounted in the slot — no ancestor-count escape hatch', () => {
    expect(workspaceCrumbs).toContain('export function PageCrumbs({ crumbs, current }: { crumbs: Crumb[]; current: ReactNode })');
    expect(workspaceCrumbs).not.toMatch(/crumbs\.length === 0/);
  });

  it('the current page renders as the non-linked BreadcrumbPage primitive, never a link', () => {
    expect(workspaceCrumbs).toContain('import {');
    expect(workspaceCrumbs).toMatch(/BreadcrumbPage,?\r?\n/);
    expect(workspaceCrumbs).toContain('<BreadcrumbPage className="block truncate">{current}</BreadcrumbPage>');
    // Ancestors alone go through BreadcrumbLink/Link; the current item is never wrapped in one.
    const currentBlock = workspaceCrumbs.slice(workspaceCrumbs.indexOf('<BreadcrumbItem className="min-w-0 flex-1">'));
    expect(currentBlock).not.toContain('<Link');
    expect(currentBlock).not.toContain('<BreadcrumbLink');
  });

  it('an ancestor is a link only where it names a real href, plain text otherwise — never a fabricated one', () => {
    expect(workspaceCrumbs).toContain('crumb.href ? (');
    expect(workspaceCrumbs).toContain('<span className="block truncate">{crumb.label}</span>');
  });

  it('workspaceAncestry reads WORKSPACES/AREAS, takes organizationId, and links a real workspace Home', () => {
    expect(navigationSource).toContain('export function workspaceAncestry(organizationId: string, segment: string)');
    expect(navigationSource).toContain("const owner = WORKSPACES.find((candidate) => candidate.key === area.workspace)!");
    // Every canonical workspace now has a real Home.
    expect(navigationSource).not.toContain('if (!owner.home)');
    expect(navigationSource).toContain('return [{ label: owner.label, href: areaHref(organizationId, owner.home) }];');
  });

  it('a workspace Home names no ancestor of its own — no "Field / Field"', () => {
    expect(navigationSource).toContain('const workspace = WORKSPACES.find((candidate) => candidate.home === segment);');
    expect(navigationSource).toMatch(/if \(workspace\) return \[\];/);
  });

  it('platformAncestry reads PLATFORM_DESTINATIONS/PLATFORM_GROUPS — no second string table of "Infrastructure"/"Catalog"/"Commercial" in a page', () => {
    expect(platformNavigationSource).toContain('export function platformAncestry(organizationId: string, destinationKey: string)');
    expect(platformNavigationSource).toContain("PLATFORM_DESTINATIONS.find((candidate) => candidate.key === destinationKey)");
    expect(platformNavigationSource).toContain('PLATFORM_GROUPS.find((candidate) => candidate.key === destination.under)');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (/\.tsx$/.test(entry.name)) {
          const source = readFileSync(`${dir}/${entry.name}`, 'utf8');
          if (/label:\s*'Infrastructure'|label:\s*'Catalog'|label:\s*'Commercial'/.test(source)) {
            offenders.push(`${dir}/${entry.name}`.slice(WEB.length));
          }
        }
      }
    };
    walk(`${WEB}/app/organizations/[organizationId]/platform`);
    walk(`${WEB}/features/platform`);
    expect(offenders).toEqual([]);
  });

  it('RecordHeader drops its own final crumb, so the current record is never duplicated as its own parent', () => {
    expect(recordHeader).toContain('crumbs={crumbs.slice(0, -1)}');
  });

  it('no page renders PageCrumbs directly — only PageLocation does, so every page goes through one contract', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (/\.tsx$/.test(entry.name) && entry.name !== 'page-location.tsx' && readFileSync(`${dir}/${entry.name}`, 'utf8').includes('<PageCrumbs')) {
          offenders.push(`${dir}/${entry.name}`.slice(WEB.length));
        }
      }
    };
    walk(`${WEB}/app`);
    walk(`${WEB}/features`);
    walk(`${WEB}/components`);
    expect(offenders).toEqual([]);
  });
});
