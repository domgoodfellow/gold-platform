'use client';

import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { SIDEBAR_HEADER_HEIGHT } from '@/components/layout/workspace-geometry';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { AccountMenu } from '@/components/navigation/account-menu';
import { SettingsNav } from '@/components/navigation/settings-nav';
import { inSettingsContext, type SettingsSearchItem } from '@/lib/settings-nav';
import { lastAppPathKey } from '@/lib/route/app-return';
import { ContextIdentity, ContextSwitcher, GOLD_MARK, type SwitchableOrganization, type SwitcherContext, type PlatformContext } from '@/components/navigation/context-switcher';
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
import { useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import { cx, FOCUS_RING } from '@/components/class-names';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  ArrowLeft,
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
  Headset,
  Landmark,
  Layers,
  LayoutDashboard,
  Library,
  MapPin,
  Megaphone,
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
  workspaceNavigation,
  selectShellContext,
  type HeaderUtility,
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
  marketing: Megaphone,
  support: Headset,
  ai: Bot,
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
  'workspace-overview': LayoutDashboard,
  // Workspace destinations share their icons across sidebar, rail and phone Menu.
  'workspace-crm': Users,
  'workspace-communications': Phone,
  'workspace-marketing': Megaphone,
  'workspace-support': Headset,
  'workspace-ai': Bot,
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
 * A leaf is a link. Platform rows retain their existing link and disclosure behavior,
 * including expanding every group while the person is inside Platform.
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
  const context = workspaceNavigation(sections, pathname);
  const navigation = context?.sections ?? sections;
  const active = activeItemKey(navigation, pathname);
  const platformActive = inPlatformScope(pathname);
  const { setOpenMobile } = useSidebar();

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
    <nav aria-label="This business" className="flex flex-1 flex-col" onClick={(event) => {
      if ((event.target as Element).closest('a[href]')) setOpenMobile(false);
    }}>
      {context ? <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to Workspaces">
              <Link href={context.backHref}><ArrowLeft aria-hidden /><span>Back to Workspaces</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup> : null}
      {navigation.map((section) => group(section, false))}
    </nav>
  );
}

export type { SwitchableOrganization };

function MobileAgentEntry() {
  const { agentOpen, toggleAgent } = useWorkspaceRail();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu className="md:hidden">
      <SidebarMenuItem>
        <SidebarMenuButton aria-pressed={agentOpen} onClick={() => {
          setOpenMobile(false);
          toggleAgent();
        }}>
          <Bot aria-hidden /><span>Agent</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
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
  organizations,
  current,
  platform,
  sections,
  settings,
  email,
  signOutAction,
  ...props
}: {
  mark: ReactNode;
  name: string;
  organizations: SwitchableOrganization[];
  current: SwitcherContext;
  platform?: PlatformContext | null;
  sections: ShellSection[];
  /** Present while the person is inside Settings: the destinations that replace the workspaces. */
  settings?: { organizationId: string; sections: ShellSection[]; search: SettingsSearchItem[] } | null;
  /** True only while the business is in SETUP — the layout decides, from `operationalState`. */
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" mobileSide="right" {...props}>
      <SidebarHeader className={cx(SIDEBAR_HEADER_HEIGHT, 'justify-center border-b border-sidebar-border pr-12 md:pr-2')}>
        <ContextSwitcher mark={mark} current={current} platform={platform} organizations={organizations} />
      </SidebarHeader>
      <SidebarContent>
        {settings ? (
          <SettingsNav organizationId={settings.organizationId} organizationName={name} sections={settings.sections} search={settings.search} />
        ) : (
          <OrgNav sections={sections} />
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <MobileAgentEntry />
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
      <SidebarHeader className={cx(SIDEBAR_HEADER_HEIGHT, 'justify-center border-b border-sidebar-border pr-12 md:pr-2')}>
        {/* Recovery keeps the phone identity noninteractive. */}
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
  organizationId, name, role, mark, organizations, sections: businessSections, utilities, settings, settingsSearch, platform,
  locked, email, signOutAction, agent, children,
}: {
  organizationId: string;
  name: string;
  role: string;
  mark: ReactNode;
  organizations: SwitchableOrganization[];
  sections: ShellSection[];
  utilities: HeaderUtility[];
  settings: ShellSection[];
  settingsSearch: SettingsSearchItem[];
  platform: (PlatformContext & { sections: ShellSection[] }) | null;
  locked: boolean;
  email: string;
  signOutAction: () => Promise<void>;
  agent: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const selected = selectShellContext(organizationId, pathname, platform);
  const settingsContext = inSettingsContext(pathname, organizationId) && settings.length > 0;

  // The last page of this business that was not Settings, so "Back to app" can return to it. Kept
  // per tab and validated again when read; losing it only means Back goes to Home.
  useEffect(() => {
    if (inSettingsContext(pathname, organizationId) || !pathname.startsWith(`/organizations/${organizationId}/`)) return;
    try {
      window.sessionStorage.setItem(lastAppPathKey(organizationId), pathname);
    } catch {
      /* storage can be unavailable; Back falls back to Home */
    }
  }, [pathname, organizationId]);
  const system = selected === 'platform';
  const current: SwitcherContext = system
    ? { kind: 'platform', organizationId }
    : { kind: 'business', organizationId, name, role };
  const sections = system ? platform!.sections : businessSections;
  const identityName = system ? 'GildOps Platform' : name;
  const identityRole = system ? 'System control plane' : role;
  const identityMark = system ? GOLD_MARK : mark;
  const recovery = locked && !system;
  const shared = { mark: identityMark, name: identityName, organizations, platform, email, signOutAction };

  return (
    <WorkspaceShell
      locationNavigation={{ organizationId, sections: recovery ? [] : settingsContext && !system ? settings : sections, configurationHrefs: recovery || system ? [] : settingsSearch.map((item) => item.href) }}
      sidebar={recovery ? <LockedOrgSidebar organizationId={organizationId} role={identityRole} {...shared} /> : <OrgSidebar {...shared} current={current} sections={sections} settings={settingsContext && !system ? { organizationId, sections: settings, search: settingsSearch } : null} />}
      header={
        <WorkspaceHeader
          navigationTrigger="always"
          agentTrigger="md"
          utilities={system ? [] : utilities}
        />
      }
      agent={agent}
    >
      {children}
    </WorkspaceShell>
  );
}
