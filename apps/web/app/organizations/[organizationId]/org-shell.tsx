'use client';

import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { AccountMenu } from '@/components/navigation/account-menu';
import { ContextIdentity, ContextSwitcher, CompactContextSwitcher, GOLD_MARK, type SwitchableOrganization, type SwitcherContext, type PlatformContext } from '@/components/navigation/context-switcher';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@gold/ui/components/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@gold/ui/components/collapsible';
import { Button } from '@/components/controls/button';
import { useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import { cx, FOCUS_RING } from '@/components/class-names';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bot,
  Blocks,
  Building2,
  CalendarDays,
  ChevronRight,
  Banknote,
  CircleDollarSign,
  FileText,
  ClipboardList,
  Coins,
  CreditCard,
  Filter,
  Gauge,
  Globe,
  Hash,
  History,
  Home,
  Landmark,
  Layers,
  LayoutDashboard,
  Library,
  MapPin,
  Menu,
  Inbox,
  LayoutTemplate,
  ListChecks,
  MessageSquare,
  PanelTop,
  Package,
  Phone,
  Plug,
  Receipt,
  Server,
  Settings,
  TriangleAlert,
  UserCog,
  Users,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  activeItemKey,
  selectShellContext,
  type HeaderUtility,
  shellHomeItem,
  inPlatformScope,
  itemContains,
  type NavItem,
  type ShellSection,
} from '@/lib/shell';

/** Renderers share the selected projection and decide no destination eligibility. */

/**
 * One icon per area, keyed by segment rather than declared on `Area` itself — icon choice is how
 * the shell draws the IA, not part of what the IA is (`navigation.ts` stays segments, labels,
 * groups, modules). `navigation.test.ts` asserts every sidebar `AREAS` entry has one here, so a new
 * area without an icon fails at the gate rather than rendering blank in the rail.
 */
export const AREA_ICONS: Record<string, LucideIcon> = {
  home: Home,
  library: Library,
  work: ClipboardList,
  field: Wrench,
  sales: Users,
  pipeline: Filter,
  comms: Phone,
  calls: Phone,
  'comms-inbox': Inbox,
  'finance-quotes': FileText,
  'finance-invoices': Receipt,
  'finance-payments': Banknote,
  'comms-numbers': Hash,
  'automation-rules': Workflow,
  'automation-messages': MessageSquare,
  'automation-activity': History,
  'studio-website': PanelTop,
  'studio-forms': ListChecks,
  'studio-templates': LayoutTemplate,
  schedule: CalendarDays,
  customers: Users,
  locations: MapPin,
  assets: Package,
  resources: Layers,
  insights: BarChart3,
  finance: CircleDollarSign,
  automations: Zap,
  studio: Globe,
  settings: Settings,
};

/** Every item the projection can produce: the areas and the platform destinations. */
export const NAV_ICONS: Record<string, LucideIcon> = {
  ...AREA_ICONS,
  // A workspace row is drawn with its Product's mark; its pages, in the phone sheet, with their own.
  'workspace-crm': Users,
  'workspace-communications': Phone,
  'workspace-finance': CircleDollarSign,
  'workspace-automations': Zap,
  'workspace-field': Wrench,
  'workspace-studio': Globe,
  team: UserCog,
  connections: Plug,
  plan: CreditCard,
  platform: LayoutDashboard,
  'platform-organizations': Building2,
  'platform-products': Package,
  'platform-group-catalog': Blocks,
  'platform-plans': Landmark,
  'platform-meters': Gauge,
  'platform-connectors': Blocks,
  'platform-pricing': CircleDollarSign,
  'platform-portfolio-economics': CircleDollarSign,
  'platform-billing': CreditCard,
  'platform-providers': Plug,
  'platform-failures': TriangleAlert,
  'platform-group-commercial': Coins,
  'platform-group-infrastructure': Server,
};

/**
 * A page nested inside a row that is itself nested inside a row — Platform's Catalog, Commercial
 * and Infrastructure, one level beneath the Platform row itself. The same link-and-disclosure
 * shape as `NavRow`, in `SidebarMenuSub`'s vocabulary instead of `SidebarMenu`'s, and recursive
 * through `NavItem.children` rather than a case built for these three groups by name — a fourth
 * nested group needs nothing new here.
 */
function NavSubRow({ item, active, expanded }: { item: NavItem; active: string | null; expanded: boolean }) {
  const current = item.key === active;
  const inside = itemContains(item, active) || expanded;
  const [open, setOpen] = useState(inside);
  const [wasInside, setWasInside] = useState(inside);
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setOpen(true);
  }

  const link = (
    <SidebarMenuSubButton asChild isActive={current} className={item.children ? 'flex-1' : undefined}>
      <Link href={item.href} aria-current={current ? 'page' : undefined}>
        <span>{item.label}</span>
      </Link>
    </SidebarMenuSubButton>
  );

  if (!item.children) return <SidebarMenuSubItem>{link}</SidebarMenuSubItem>;

  return (
    <SidebarMenuSubItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-1">
          {link}
          <CollapsibleTrigger
            aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
            className={cx(
              FOCUS_RING,
              'flex size-6 shrink-0 items-center justify-center rounded text-sidebar-foreground transition-transform hover:bg-sidebar-accent data-[state=open]:rotate-90',
            )}
          >
            <ChevronRight aria-hidden size={14} />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className="mx-2 mt-1">
            {item.children.map((child) => (
              <NavSubRow key={child.key} item={child} active={active} expanded={expanded} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuSubItem>
  );
}

/**
 * One row of the sidebar. A leaf is a link. A row with pages is a link **and** a disclosure: the
 * row goes to the workspace's own overview (or, for Platform, to its own root) so the collapsed
 * icon rail — which cannot show children — still reaches somewhere real, and the chevron beside it
 * opens the pages. The branch a person is inside is open, and opens itself when they navigate into
 * it from elsewhere; otherwise it stays as they left it. Platform is the exception that opens every
 * group at once, down through `NavSubRow`, while somebody is inside it.
 */
function NavRow({ item, active, expanded }: { item: NavItem; active: string | null; expanded: boolean }) {
  const Icon = NAV_ICONS[item.key];
  const current = item.key === active;
  // `expanded` is Platform's own rule: while somebody is working inside it, every Platform group is
  // open, so the whole control plane is in view rather than one group of it.
  const inside = itemContains(item, active) || expanded;
  const [open, setOpen] = useState(inside);
  // Opens on the render that moves the person inside, not in an effect after it: the branch is
  // never drawn closed for a frame first. Leaving does not close it — that is theirs to do.
  const [wasInside, setWasInside] = useState(inside);
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setOpen(true);
  }

  const link = (
    <SidebarMenuButton asChild isActive={current} tooltip={item.label}>
      <Link href={item.href} aria-current={current ? 'page' : undefined}>
        {Icon ? <Icon aria-hidden /> : null}
        <span>{item.label}</span>
      </Link>
    </SidebarMenuButton>
  );

  if (!item.children) return <SidebarMenuItem>{link}</SidebarMenuItem>;

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        {link}
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
            className="data-[state=open]:rotate-90"
          >
            <ChevronRight aria-hidden />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children.map((child) => (
              <NavSubRow key={child.key} item={child} active={active} expanded={expanded} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/** Every breakpoint draws the selected context's already resolved sections. */
export function OrgNav({ sections }: { sections: ShellSection[] }) {
  const pathname = usePathname();
  const active = activeItemKey(sections, pathname);
  const platformActive = inPlatformScope(pathname);

  const group = (section: ShellSection, ruled: boolean) => (
    <SidebarGroup key={section.key} className={ruled ? 'border-t border-sidebar-border' : undefined}>
      {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {section.items.map((item) => (
            <NavRow key={item.key} item={item} active={active} expanded={section.key === 'platform' && platformActive} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
  return (
    <nav aria-label="This business" className="flex flex-1 flex-col">
      {sections.map((section) => group(section, false))}
    </nav>
  );
}

export type { SwitchableOrganization };

const BAR_CELL =
  'h-full w-full flex-col gap-0.5 rounded border-0 px-0 text-xs font-medium shadow-none';

/** AI and Menu are buttons whose state is `aria-pressed` / `aria-expanded`; the shared Button styles those, so the bar restates them to match Home's current state. */
const BAR_TOGGLE =
  'bg-transparent hover:bg-hover aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground aria-expanded:bg-foreground aria-expanded:text-background aria-expanded:hover:bg-foreground';

/**
 * The phone's persistent bar: exactly three equal cells and nothing that scrolls.
 *
 * - **Home** is the projected Home item, whatever address `projectShell` gave it.
 * - **AI** toggles the one workspace-global Agent (`useWorkspaceRail`), the same call the header's
 *   `AgentTrigger` makes; its pressed state is `agentOpen`.
 * - **Menu** opens the sidebar's own phone Sheet (`useSidebar`), which renders `OrgSidebar` — the
 *   same `sections` the desktop sidebar draws, workspace rows and Platform included. The bar holds no
 *   destination of its own, so it decides no eligibility.
 *
 * It renders outside `Sidebar`, as a sibling inside `SidebarProvider`, so it can read both contexts.
 * Its height is `--mobile-nav-height` (`workspace-geometry.ts`), which the page inset and the phone
 * Agent panel read too.
 */
export function OrgNavBar({ sections }: { sections: ShellSection[] }) {
  const pathname = usePathname();
  const active = activeItemKey(sections, pathname);
  const home = shellHomeItem(sections);
  const { agentOpen, toggleAgent } = useWorkspaceRail();
  const { openMobile, setOpenMobile } = useSidebar();

  // The Sheet does not close itself when a link inside it is followed.
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);

  return (
    <nav
      aria-label="This business"
      className="fixed inset-x-0 bottom-0 z-20 h-(--mobile-nav-height) border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid h-full grid-cols-3 gap-1 p-1">
        <li className="min-w-0">
          {home ? (
            <Link
              href={home.href}
              aria-current={home.key === active ? 'page' : undefined}
              className={cx(FOCUS_RING, 'flex items-center justify-center', BAR_CELL, home.key === active ? 'bg-foreground text-background' : 'hover:bg-hover')}
            >
              <Home aria-hidden size={20} />
              Home
            </Link>
          ) : null}
        </li>
        <li className="min-w-0">
          <Button
            type="button"
            tone="secondary"
            aria-label="AI"
            aria-pressed={agentOpen}
            onClick={toggleAgent}
            className={cx(BAR_CELL, BAR_TOGGLE)}
          >
            <Bot aria-hidden size={20} />
            AI
          </Button>
        </li>
        <li className="min-w-0">
          <Button
            type="button"
            tone="secondary"
            aria-label="Menu"
            aria-expanded={openMobile}
            onClick={() => setOpenMobile(!openMobile)}
            className={cx(BAR_CELL, BAR_TOGGLE)}
          >
            <Menu aria-hidden size={20} />
            Menu
          </Button>
        </li>
      </ul>
    </nav>
  );
}

/**
 * The whole operator sidebar: identity and context switching in the header, Setup (while it
 * applies) and the projected sections in the content, the account menu in the footer.
 * `collapsible="icon"` and everything collapse-related is `Sidebar`'s own state, shared with every
 * other workspace shell rather than a second, `localStorage`-backed implementation beside it. On a phone
 * the same sidebar is the Menu: its own Sheet, opened from the right (`mobileSide`), drawing these same sections.
 */
export function OrgSidebar({
  mark,
  name,
  role,
  organizations,
  current,
  platform,
  sections,
  email,
  signOutAction,
  ...props
}: {
  mark: ReactNode;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  current: SwitcherContext;
  platform?: PlatformContext | null;
  sections: ShellSection[];
  /** True only while the business is in SETUP — the layout decides, from `operationalState`. */
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" mobileSide="right" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        {/* On a phone this sidebar is the Menu sheet: it names the business and does not offer a second
            switcher, because the header's compact switcher is the one phone control for that. */}
        <div className="md:hidden">
          <ContextIdentity mark={mark} name={name} role={role} />
        </div>
        <div className="hidden md:block">
          <ContextSwitcher
            mark={mark}
            current={current}
            platform={platform}
            organizations={organizations}
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <OrgNav sections={sections} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <AccountMenu email={email} signOutAction={signOutAction} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * The sidebar while the business's commercial service access is locked: identity and context
 * switching, one row to where recovery lives, and the account menu. Not the enforcement — every
 * page and action refuses on its own — only the shell agreeing with them, so a locked person is
 * not offered twelve doors that all lead to the same locked screen.
 */
export function LockedOrgSidebar({
  organizationId,
  mark,
  name,
  role,
  organizations,
  platform,
  email,
  signOutAction,
  ...props
}: {
  organizationId: string;
  mark: ReactNode;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  platform?: PlatformContext | null;
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  const current = usePathname().includes('/settings/plan');

  return (
    <Sidebar collapsible="icon" mobileSide="right" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        {/* On a phone this sidebar is the Menu sheet: it names the business and does not offer a second
            switcher, because the header's compact switcher is the one phone control for that. */}
        <div className="md:hidden">
          <ContextIdentity mark={mark} name={name} role={role} />
        </div>
        <div className="hidden md:block">
          <ContextSwitcher
            mark={mark}
            current={{ kind: 'business', organizationId, name, role }}
            platform={platform}
            organizations={organizations}
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={current} tooltip="Plan & usage">
                <Link
                  href={`/organizations/${organizationId}/settings/plan`}
                  aria-current={current ? 'page' : undefined}
                >
                  <Settings aria-hidden />
                  <span>Plan &amp; usage</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><AccountMenu email={email} signOutAction={signOutAction} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Layouts persist across client navigation: select the already authorized context on each path. */
export function OrganizationFrame({
  organizationId, name, role, mark, organizations, sections: businessSections, utilities, platform,
  locked, email, signOutAction, agent, children,
}: {
  organizationId: string;
  name: string;
  role: string;
  mark: ReactNode;
  organizations: SwitchableOrganization[];
  sections: ShellSection[];
  utilities: HeaderUtility[];
  platform: (PlatformContext & { sections: ShellSection[] }) | null;
  locked: boolean;
  email: string;
  signOutAction: () => Promise<void>;
  agent: ReactNode;
  children: ReactNode;
}) {
  const selected = selectShellContext(organizationId, usePathname(), platform);
  const system = selected === 'platform';
  const current: SwitcherContext = system
    ? { kind: 'platform', organizationId }
    : { kind: 'business', organizationId, name, role };
  const sections = system ? platform!.sections : businessSections;
  const identityName = system ? 'GildOps Platform' : name;
  const identityRole = system ? 'System control plane' : role;
  const identityMark = system ? GOLD_MARK : mark;
  const recovery = locked && !system;
  const shared = { mark: identityMark, name: identityName, role: identityRole, organizations, platform, email, signOutAction };

  return (
    <WorkspaceShell
      sidebar={recovery ? <LockedOrgSidebar organizationId={organizationId} {...shared} /> : <OrgSidebar {...shared} current={current} sections={sections} />}
      header={
        <WorkspaceHeader
          navigationTrigger={recovery ? 'always' : 'md'}
          agentTrigger="md"
          utilities={system ? [] : utilities}
          context={
            <div className="flex min-w-0 items-center gap-3 md:hidden">
              <CompactContextSwitcher mark={identityMark} current={current} organizations={organizations} platform={platform} />
            </div>
          }
        />
      }
      bottomBar={recovery ? undefined : <OrgNavBar sections={sections} />}
      agent={agent}
    >
      {children}
    </WorkspaceShell>
  );
}
