'use client';

import { CommandCenterProvider, CommandPalette, SearchEntry } from '@/features/home/command-center';
import { LibraryMenu } from '@/features/library/library-nav';

import { NavigationActivityContext } from '@/components/navigation/activity-context';
import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { SIDEBAR_HEADER_HEIGHT } from '@/components/layout/workspace-geometry';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { AccountMenu } from '@/components/navigation/account-menu';
import { SettingsNav } from '@/components/navigation/settings-nav';
import { inSettingsContext, type SettingsSearchItem } from '@/lib/settings-nav';
import type { SerializedLocationAccess } from '@/lib/route/page-location';
import { lastAppPathKey } from '@/lib/route/app-return';
import { ContextIdentity, ContextSwitcher, type SwitchableOrganization, type SwitcherContext } from '@/components/navigation/context-switcher';
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
import { useContext, useEffect, useState, type ReactNode } from 'react';
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
  Globe,
  Hash,
  History,
  Home,
  Headset,
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
  ShieldCheck,
  Plug,
  Receipt,
  Server,
  Settings,
  Timer,
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
  shellHomeItem,
  topLevelSections,
  workspaceNavigation,
  type HeaderUtility,
  inPlatformScope,
  itemContains,
  type NavItem,
  type ShellSection,
} from '@/lib/shell';

/** Renderers share the selected projection and decide no destination eligibility. */

/**
 * One icon per area, keyed by segment rather than declared on `Area` itself â€” icon choice is how
 * the shell draws the IA, not part of what the IA is (`navigation.ts` stays segments, labels,
 * groups, modules). `navigation.test.ts` asserts every sidebar `AREAS` entry has one here, so a new
 * area without an icon fails at the gate rather than rendering blank in the rail.
 */
export const AREA_ICONS: Record<string, LucideIcon> = {
  home: Home,
  library: Library,
  marketing: Megaphone,
  support: Headset,
  'support-cases': ClipboardList,
  'support-queue-workbench': ListChecks,
  'support-service-levels-view': Timer,
  'support-reports': BarChart3,
  'marketing-campaigns': Megaphone,
  'marketing-audiences': Users,
  'marketing-leads': Inbox,
  'marketing-performance': BarChart3,
  'ai-activity': History,
  'ai-evaluations': ListChecks,
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
  'studio-portal': Users,
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

/** Every item the projection can produce: the areas and the Administration destinations. */
export const NAV_ICONS: Record<string, LucideIcon> = {
  ...AREA_ICONS,
  'workspace-overview': LayoutDashboard,
  'workspace-configuration': Settings,
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
  administration: ShieldCheck,
  'platform-overview': LayoutDashboard,
  'platform-organizations': Building2,
  'platform-group-product-registry': Package,
  'platform-group-integration-registry': Blocks,
  'platform-group-infrastructure': Server,
  'platform-group-reliability': TriangleAlert,
  'platform-group-commercial': Coins,
  'platform-link-commercial': Coins,
  'platform-link-ai-runtime': Server,
};

/**
 * A page nested inside a row that is itself nested inside a row. The same link-and-disclosure
 * shape as `NavRow`, in `SidebarMenuSub`'s vocabulary instead of `SidebarMenu`'s, and recursive
 * through `NavItem.children` rather than a case built for particular groups by name.
 */
function NavSubRow({ item, active }: { item: NavItem; active: string | null }) {
  const retainActivity = useContext(NavigationActivityContext);
  const current = item.key === active;
  const inside = itemContains(item, active);
  const [open, setOpen] = useState(inside);
  const [wasInside, setWasInside] = useState(inside);
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setOpen(true);
  }

  const link = (
    <SidebarMenuSubButton asChild isActive={current} className={cx(item.children && 'flex-1', (item.section === 'workspaces' || item.section === 'administration') && 'h-auto min-h-11 md:min-h-7')}>
      <Link href={item.href} target={retainActivity && item.href.startsWith('/platform') ? '_blank' : undefined} rel={retainActivity && item.href.startsWith('/platform') ? 'noopener noreferrer' : undefined} aria-current={current ? 'page' : undefined}>
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
              'flex size-11 shrink-0 items-center justify-center rounded text-sidebar-foreground md:size-6 transition-transform hover:bg-sidebar-accent data-[state=open]:rotate-90',
            )}
          >
            <ChevronRight aria-hidden size={14} />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className="mx-2 mt-1">
            {item.children.map((child) => (
              <NavSubRow key={child.key} item={child} active={active} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuSubItem>
  );
}

/**
 * A leaf is a link. A row with pages is a link and a disclosure, open while the person is inside it.
 */
function NavRow({ item, active }: { item: NavItem; active: string | null }) {
  const retainActivity = useContext(NavigationActivityContext);
  const Icon = NAV_ICONS[item.key];
  const current = item.key === active;
  const inside = itemContains(item, active);
  const [open, setOpen] = useState(inside);
  // Opens on the render that moves the person inside, not in an effect after it: the branch is
  // never drawn closed for a frame first. Leaving does not close it â€” that is theirs to do.
  const [wasInside, setWasInside] = useState(inside);
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setOpen(true);
  }

  const link = (
    <SidebarMenuButton asChild isActive={current} tooltip={item.label} className={item.children ? 'max-md:min-h-11' : undefined}>
      <Link href={item.href} target={retainActivity && item.href.startsWith('/platform') ? '_blank' : undefined} rel={retainActivity && item.href.startsWith('/platform') ? 'noopener noreferrer' : undefined} aria-current={current ? 'page' : undefined}>
        {Icon ? <Icon aria-hidden /> : null}
        <span>{item.label}</span>
      </Link>
    </SidebarMenuButton>
  );

  if (!item.children) return <SidebarMenuItem className={item.key === 'workspace-configuration' || item.key.startsWith('platform-link-') ? 'mt-2 border-t border-sidebar-border pt-2' : undefined}>{link}</SidebarMenuItem>;

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        {link}
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
            className="data-[state=open]:rotate-90 max-md:top-0! max-md:right-0! max-md:h-11! max-md:w-11!"
          >
            <ChevronRight aria-hidden />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children.map((child) => (
              <NavSubRow key={child.key} item={child} active={active} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/**
 * Home, Search and Library: the same three controls at every depth of the organization, drawn once
 * by this component for the business's own rows and for any workspace or Administration context.
 */
function PrimaryNavigation({ organizationId, home, library, active }: { organizationId: string; home?: NavItem; library?: NavItem; active: string | null }) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {home ? <NavRow item={home} active={active} /> : null}
        <SidebarMenuItem><SearchEntry /></SidebarMenuItem>
        {library ? <LibraryMenu organizationId={organizationId} label={library.label} /> : null}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * Every breakpoint draws the same resolved sections: the primary controls, then either the business's
 * workspace directory or, once somebody has entered a workspace or Administration, that context's own
 * destinations. Leaving a context is Home's job, so no separate "back" row is drawn.
 */
export function OrgNav({ sections, organizationId }: { sections: ShellSection[]; organizationId: string }) {
  const pathname = usePathname();
  const context = workspaceNavigation(sections, pathname);
  const topLevel = topLevelSections(sections);
  const home = shellHomeItem(sections);
  const library = topLevel.flatMap((section) => section.items).find((item) => item.key === 'library');
  const navigation = context?.sections ?? topLevel
    .map((section) => ({ ...section, label: section.key === 'home' ? 'Workspaces' : section.label, items: section.items.filter((item) => !['home', 'library'].includes(item.key)) }))
    .filter((section) => section.items.length);
  const active = activeItemKey([...sections.filter((section) => section.key === 'home'), ...navigation], pathname);
  const { setOpenMobile } = useSidebar();

  const group = (section: ShellSection) => (
    <SidebarGroup key={section.key} className={!context && section.key === 'administration' ? 'border-t border-sidebar-border' : undefined}>
      {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {section.items.map((item) => (
            <NavRow key={item.key} item={item} active={active} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
  return (
    <nav aria-label="This business" className="flex flex-1 flex-col" onClick={(event) => {
      if ((event.target as Element).closest('a[href]')) setOpenMobile(false);
    }}>
      <PrimaryNavigation organizationId={organizationId} home={home} library={library} active={active} />
      {navigation.map(group)}
    </nav>
  );
}

export type { SwitchableOrganization };

function MobileAgentEntry() {
  const { agentOpen, openAgent } = useWorkspaceRail();
  const { setOpenMobile, mobileTriggerRef } = useSidebar();
  return (
    <SidebarMenu className="md:hidden">
      <SidebarMenuItem>
        <SidebarMenuButton aria-pressed={agentOpen} onClick={() => {
          setOpenMobile(false);
          openAgent(mobileTriggerRef.current);
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
  sections,
  settings,
  email,
  signOutAction,
  displayName,
  setupPending,
  organizationId,
  ...props
}: {
  organizationId: string;
  displayName?: string;
  /** True while the business is in SETUP: the switcher says so, quietly, beneath its name. */
  setupPending?: boolean;
  mark: ReactNode;
  name: string;
  organizations: SwitchableOrganization[];
  current: SwitcherContext;
  sections: ShellSection[];
  /** Present while the person is inside Settings: the destinations that replace the workspaces. */
  settings?: { organizationId: string; sections: ShellSection[]; search: SettingsSearchItem[] } | null;
  /** True only while the business is in SETUP â€” the layout decides, from `operationalState`. */
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" mobileSide="right" {...props}>
      <SidebarHeader className={cx(SIDEBAR_HEADER_HEIGHT, 'justify-center border-b border-sidebar-border pr-12 md:pr-2')}>
        <ContextSwitcher mark={mark} current={current} organizations={organizations} setupPending={setupPending} />
      </SidebarHeader>
      <SidebarContent>
        {settings ? (
          <SettingsNav organizationId={settings.organizationId} organizationName={name} sections={settings.sections} search={settings.search} returnHrefs={sections.flatMap((section) => section.items.flatMap((item) => [item.href, ...(item.activeHrefs ?? []), ...(item.destinations ?? []).map((destination) => destination.href)]))} />
        ) : (
          <OrgNav sections={sections} organizationId={organizationId} />
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <MobileAgentEntry />
        <AccountMenu email={email} signOutAction={signOutAction} displayName={displayName} role={current.kind === 'business' ? current.role : undefined} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * The sidebar while the business's commercial service access is locked: identity and context
 * switching, one row to where recovery lives, GildOps staff's Administration entry (which stays
 * reachable while GildOps' own service is locked), and the account menu. Not the enforcement â€”
 * every page and action refuses on its own â€” only the shell agreeing with them, so a locked person
 * is not offered twelve doors that all lead to the same locked screen.
 */
export function LockedOrgSidebar({
  organizationId,
  mark,
  name,
  role,
  organizations,
  administration,
  email,
  signOutAction,
  ...props
}: {
  organizationId: string;
  mark: ReactNode;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  administration?: NavItem;
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
        {administration ? (
          <SidebarGroup className="border-t border-sidebar-border">
            <SidebarMenu>
              <NavRow item={{ ...administration, destinations: undefined }} active={null} />
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><AccountMenu email={email} signOutAction={signOutAction} locked /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * Layouts persist across client navigation. The identity is always this organization's own â€”
 * Administration inside GildOps changes the navigation, never who the person is working as.
 */
export function OrganizationFrame({
  organizationId, name, role, mark, organizations, sections, utilities, settings, settingsSearch,
  locked, email, signOutAction, agent, children, displayName = '', setupPending = false, locationAccess,
}: {
  displayName?: string;
  /** The shell's entitlement and permission facts, for pages whose location the resolver owns. */
  locationAccess?: SerializedLocationAccess;
  setupPending?: boolean;
  organizationId: string;
  name: string;
  role: string;
  mark: ReactNode;
  organizations: SwitchableOrganization[];
  sections: ShellSection[];
  utilities: HeaderUtility[];
  settings: ShellSection[];
  settingsSearch: SettingsSearchItem[];
  locked: boolean;
  email: string;
  signOutAction: () => Promise<void>;
  agent: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
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
  const current: SwitcherContext = { kind: 'business', organizationId, name, role };
  // A locked GildOps keeps Administration working: recovery replaces the sidebar everywhere else.
  const recovery = locked && !inPlatformScope(pathname);
  const administration = sections.find((section) => section.key === 'administration')?.items[0];
  const shared = { mark, name, organizations, email, signOutAction };
  const calendarContext = !recovery && !settingsContext ? workspaceNavigation(sections, pathname) : null;
  const calendarWorkspace = calendarContext?.workspace.key.startsWith('workspace-') ? calendarContext.workspace : null;

  return (
    <CommandCenterProvider key={organizationId} organizationId={organizationId} displayName={displayName}><WorkspaceShell
      locationNavigation={{ organizationId, sections: recovery ? [] : settingsContext ? settings : sections, configurationHrefs: recovery ? [] : settingsSearch.map((item) => item.href), ...(recovery || !locationAccess ? {} : { access: locationAccess }) }}
      sidebar={recovery ? <LockedOrgSidebar organizationId={organizationId} role={role} administration={administration} {...shared} /> : <OrgSidebar {...shared} organizationId={organizationId} displayName={displayName} setupPending={setupPending} current={current} sections={sections} settings={settingsContext ? { organizationId, sections: settings, search: settingsSearch } : null} />}
      header={
        <WorkspaceHeader
          navigationTrigger="always"
          agentTrigger="md"
          utilities={utilities}
          beforeActions={<>{!recovery ? <CommandPalette /> : null}{calendarWorkspace ? <Link href={`${calendarWorkspace.href}/calendar`} aria-label={`${calendarWorkspace.label} calendar`} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-hover"><CalendarDays aria-hidden size={16}/><span className="hidden sm:inline">Calendar</span></Link> : null}</>}
        />
      }
      agent={agent}
    >
      {children}
    </WorkspaceShell></CommandCenterProvider>
  );
}
