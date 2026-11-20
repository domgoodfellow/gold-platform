import { areaHref, areaLabel, type WorkspaceKey } from '@/lib/navigation';
import { organizationIdFromPath } from '@/lib/route/platform-context';
import { platformSubpath } from '@/lib/platform-navigation';
import { projectedItems, shellHomeItem, topLevelSections, workspaceNavigation, type ContextNavigation, type NavItem, type ShellSection } from '@/lib/shell';

/**
 * The unified layout (ADR-056), composed from the authorized projection `projectShell` already
 * produced. It decides arrangement only: every row here is a row the contextual layout offers this
 * person too, with the same address, label and selected state. Nothing is added that the projection
 * did not grant, so the layout can never widen what a person may open.
 *
 * Three scopes:
 * - Operations: the six operating workspaces as groups in one persistent sidebar.
 * - Studio: an entered creation context gathering Studio, AI and Automations, whose routes and
 *   runtime owners are unchanged.
 * - Administration: the existing separate context, unchanged.
 */

/** The operating workspaces that share one sidebar, in the order they are drawn. */
export const OPERATIONS_WORKSPACES: readonly WorkspaceKey[] = ['crm', 'communications', 'marketing', 'support', 'field', 'finance'];

/** Workspaces whose authoring tools Studio gathers. Each keeps its own routes, records and engine. */
export const STUDIO_WORKSPACES: readonly WorkspaceKey[] = ['studio', 'ai', 'automations'];

export type UnifiedNavigation = {
  /** The entered context (Studio or Administration), or null for the operations sidebar. */
  context: ContextNavigation | null;
  sections: ShellSection[];
  /** The group the current address belongs to. It opens even where no row is selected (a task, a record). */
  owner: string | null;
};

function workspaceRow(sections: readonly ShellSection[], key: WorkspaceKey): NavItem | undefined {
  return projectedItems(sections).find((item) => item.key === `workspace-${key}`);
}

/** Keys are unique within one rendered context, and every workspace has a Dashboard and a Settings row. */
function within(prefix: string, item: NavItem): NavItem {
  return { ...item, key: `${prefix}/${item.key}`, ...(item.children ? { children: item.children.map((child) => within(prefix, child)) } : {}) };
}

/**
 * One operating workspace as a group. Its heading links to the workspace Dashboard (so Dashboard is
 * not repeated as a child); a member who may only configure the workspace gets a heading with no
 * page of its own. Its pages, then its Settings, then any staff link, follow beneath it.
 */
function operationsGroup(row: NavItem): NavItem {
  const pages = row.destinations ?? [];
  const dashboard = pages.some((page) => page.key === 'workspace-dashboard');
  const children = [
    ...pages.filter((page) => page.key !== 'workspace-dashboard'),
    ...(row.configuration ? [row.configuration] : []),
    ...(row.administration ? [row.administration] : []),
  ].map((child) => within(row.key, child));
  return {
    key: row.key,
    label: row.label,
    href: row.href,
    section: 'operations',
    ...(dashboard ? { exact: true } : { group: true }),
    ...(children.length ? { children } : {}),
  };
}

/** A creation group headed by its owning workspace's Dashboard, e.g. AI's agents or Automations' workflows. */
function creationGroup(row: NavItem, children: readonly NavItem[]): NavItem {
  const dashboard = row.destinations?.some((page) => page.key === 'workspace-dashboard');
  return {
    key: row.key,
    label: row.label,
    href: row.href,
    section: 'creation',
    ...(dashboard ? { exact: true } : { group: true }),
    ...(children.length ? { children: [...children] } : {}),
  };
}

const pagesOf = (row: NavItem | undefined) => (row?.destinations ?? []).filter((page) => page.key !== 'workspace-dashboard');

/**
 * Studio's creation context: Overview, Experiences (Website, Customer portal, Forms, Templates), the
 * AI workspace's agent tools, the Automations workspace's workflow tools, GildOps' Interface design
 * for staff, and Studio's links to shared Settings. Each entry is the projection's own row.
 */
export function studioContext(sections: readonly ShellSection[], organizationId: string): ContextNavigation | null {
  const studio = workspaceRow(sections, 'studio');
  const ai = workspaceRow(sections, 'ai');
  const automations = workspaceRow(sections, 'automations');
  const anchor = studio ?? ai ?? automations;
  if (!anchor) return null;

  const items: NavItem[] = [];
  const overview = studio?.destinations?.find((page) => page.key === 'workspace-dashboard');
  if (overview) items.push({ ...overview, label: 'Overview' });
  const experiences = pagesOf(studio);
  if (experiences.length) items.push({ key: 'studio-experiences', label: 'Experiences', href: experiences[0].href, section: 'creation', group: true, children: experiences });
  if (ai) items.push(creationGroup(ai, [...(ai.configureDoors ?? []), ...pagesOf(ai), ...(ai.administration ? [ai.administration] : [])]));
  if (automations) items.push(creationGroup(automations, pagesOf(automations)));
  if (studio?.design) items.push(studio.design);
  if (studio?.configuration) items.push(studio.configuration);

  return {
    workspace: { ...anchor, key: 'workspace-studio', label: studio?.label ?? anchor.label },
    backHref: areaHref(organizationId, 'home'),
    sections: [{ key: 'workspaces', label: studio?.label ?? anchor.label, items }],
  };
}

/** The Studio row of the operations sidebar: one way into the creation context. */
function studioEntry(sections: readonly ShellSection[]): NavItem | undefined {
  const anchor = STUDIO_WORKSPACES.map((key) => workspaceRow(sections, key)).find(Boolean);
  if (!anchor) return undefined;
  const studio = workspaceRow(sections, 'studio');
  return { key: 'workspace-studio', label: studio?.label ?? anchor.label, href: anchor.href, section: 'creation' };
}

/** What the sidebar draws in the unified layout at `pathname`. */
export function unifiedNavigation(sections: readonly ShellSection[], pathname: string): UnifiedNavigation {
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, '');
  const organizationId = organizationIdFromPath(path) ?? organizationIdFromPath(shellHomeItem(sections)?.href ?? '');
  const entered = organizationId ? workspaceNavigation(sections, path) : null;

  // Administration stays its own entered context, with its existing guard and registry.
  if (entered && platformSubpath(path) !== null) return { context: entered, sections: entered.sections, owner: entered.workspace.key };

  const enteredKey = entered?.workspace.key.replace(/^workspace-/, '') as WorkspaceKey | undefined;
  if (organizationId && enteredKey && STUDIO_WORKSPACES.includes(enteredKey)) {
    const studio = studioContext(sections, organizationId);
    if (studio) return { context: studio, sections: studio.sections, owner: 'workspace-studio' };
  }

  const groups = OPERATIONS_WORKSPACES.map((key) => workspaceRow(sections, key)).filter((row): row is NavItem => Boolean(row)).map(operationsGroup);
  const studio = studioEntry(sections);
  const settings: NavItem | undefined = organizationId ? { key: 'settings', label: areaLabel('settings'), href: areaHref(organizationId, 'settings'), section: 'creation' } : undefined;
  const administration = topLevelSections(sections).filter((section) => section.key === 'administration');

  return {
    context: null,
    sections: [
      ...(groups.length ? [{ key: 'operations' as const, label: null, items: groups }] : []),
      { key: 'creation' as const, label: null, items: [studio, settings].filter((item): item is NavItem => Boolean(item)) },
      ...administration,
    ].filter((section) => section.items.length > 0),
    owner: entered?.workspace.key ?? null,
  };
}
