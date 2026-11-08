import {
  AREAS,
  CONFIG_TARGETS,
  WORKSPACES,
  WORKSPACE_CONFIGURE,
  areaAvailable,
  configTarget,
  configTargetOffered,
  workspaceConfigureItems,
  type ConfigGate,
  type ConfigTarget,
  type WorkspaceKey,
} from '@/lib/navigation';
import { PLATFORM_DESTINATIONS } from '@/lib/platform-navigation';
import { LIBRARY_SECTIONS } from '@/lib/route/library';
import { PERSONAL_SECTIONS } from '@/lib/route/personal-settings';
import { projectSettingsNav } from '@/lib/settings-nav';
import type { NavItem, ShellSection } from '@/lib/shell';
import { businessNoun, type BusinessEntity, type BusinessProfile } from '@/lib/domain/tenancy/business-profile';
import type { PlatformCapability } from '@/lib/domain/platform/permissions';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * Where a page is: the one page-location resolver (ADR-047, `docs/ui-system.md` → *Page location
 * contract*). Pure, with no domain reads, so the server and the browser compute the same answer.
 *
 * **It is not a second navigation registry.** Static locations are derived from the registries that
 * already own them — `WORKSPACES`/`AREAS`, `CONFIG_TARGETS`/`WORKSPACE_CONFIGURE`, the Settings
 * projection, `LIBRARY_SECTIONS`, `PERSONAL_SECTIONS` and `PLATFORM_DESTINATIONS` — and keep their
 * labels and paths. `LOCATION_METADATA` adds only what those registries do not know: records,
 * sub-views, creation and state routes, grouping levels and the few labels nothing else holds.
 *
 * Four questions stay separate: whether a route exists (an explicit pattern matches), whether the
 * viewer may open it (the registries' own entitlement and permission predicates), whether the
 * sidebar shows it (`inNavigation`, only when a projection is supplied) and where it sits (`parent`).
 * A link is a courtesy; every page still enforces its own authority.
 */

export type LocationScope = 'organization' | 'settings' | 'personal' | 'platform';
export type LocationKind = 'home' | 'workspace' | 'destination' | 'configuration' | 'target' | 'record' | 'view' | 'create' | 'state' | 'group';
export type RecordLabel = { state: 'ready'; label: string } | { state: 'loading' } | { state: 'missing' };

type LocationNode = {
  /** Stable location identifier; derived from the registry key it represents. */
  id: string;
  scope: LocationScope;
  kind: LocationKind;
  /** Path beneath the scope root, `[param]` for a dynamic segment; `null` for a level with no address. */
  pattern: string | null;
  parent?: string;
  /** Registry references the label, access and owner are read from. */
  area?: string;
  target?: string;
  workspace?: WorkspaceKey;
  platform?: string;
  /** A label nothing else holds: a sub-view, a step or a grouping level. */
  label?: string;
  /** The dynamic segment whose server-loaded label names this location. */
  record?: string;
  /**
   * The business noun a record location falls back to when its label was never supplied — what
   * kind of thing it is, never which one. Required of every record route that adopts the resolver.
   */
  noun?: BusinessEntity;
  recordLabel?: (label: string) => string;
  /** The address only redirects or groups: never a link and never a current page. */
  redirect?: true;
  /** A decision still outstanding for this location (Batch reviews). */
  open?: string;
};

/**
 * Areas whose route exists only to redirect. Their address is never a link and never a current
 * page; `library` and `settings` are also the plain-text grouping levels of their sections.
 */
const REDIRECT_AREAS = new Set(['library', 'organization-calendar-legacy', 'follow-up-calendar', 'insights', 'pricing', 'fields', 'roles', 'integrations', 'settings']);

/** Labels for Settings pages the Settings projection does not list. */
const SETTINGS_LABELS: Readonly<Record<string, string>> = { 'custom-fields': 'Custom fields', 'public-profile': 'Public profile', secrets: 'Secrets & credentials' };

/** Outstanding ownership decisions, carried on the location until Batch 3 settles them. */
const OPEN_TARGETS: Readonly<Record<string, string>> = {
  'phone-numbers': 'U-3', 'support-queues': 'B-D5', 'support-service-levels': 'B-D5',
  'ai-agents': 'U-5', 'ai-deployments': 'U-5', 'ai-knowledge': 'U-5', 'ai-tools': 'U-5', 'custom-fields': 'U-7', secrets: 'U-7',
};

/** Business nouns are keyed by entity; these destinations are named by one. Never matched by displayed word (A2). */
const DESTINATION_NOUNS: Readonly<Record<string, BusinessEntity>> = {
  customers: 'customer', opportunities: 'opportunity', work: 'work', 'finance-invoices': 'invoice', 'finance-quotes': 'quote', resources: 'resource', locations: 'location',
};

const PLATFORM_ROOT_LABEL = 'Platform';

/** What the registries cannot say: records, sub-views, creation and state routes. */
const LOCATION_METADATA: readonly LocationNode[] = [
  // CRM
  { id: 'record:customer', scope: 'organization', kind: 'record', pattern: 'crm/contacts/[contactId]', parent: 'area:customers', record: 'contactId', noun: 'customer' },
  { id: 'record:opportunity', scope: 'organization', kind: 'record', pattern: 'crm/opportunities/[opportunityId]', parent: 'area:opportunities', record: 'opportunityId', noun: 'opportunity' },
  // Communications
  { id: 'record:call', scope: 'organization', kind: 'record', pattern: 'calls/[callId]', parent: 'area:calls', record: 'callId' },
  { id: 'record:conversation', scope: 'organization', kind: 'record', pattern: 'comms/inbox/[conversationId]', parent: 'area:comms-inbox', record: 'conversationId' },
  { id: 'create:conversation', scope: 'organization', kind: 'create', pattern: 'comms/inbox/new', parent: 'area:comms-inbox', label: 'New conversation' },
  { id: 'view:website-conversations', scope: 'organization', kind: 'view', pattern: 'comms/inbox/website', parent: 'area:comms-inbox', label: 'Website conversations', open: 'U-2' },
  { id: 'record:phone-number', scope: 'organization', kind: 'record', pattern: 'comms/configuration/numbers/[phoneNumberId]', parent: 'target:phone-numbers', record: 'phoneNumberId' },
  // Marketing and Support
  { id: 'record:campaign', scope: 'organization', kind: 'record', pattern: 'marketing/campaigns/[campaignId]', parent: 'area:marketing-campaigns', record: 'campaignId' },
  { id: 'record:case', scope: 'organization', kind: 'record', pattern: 'support/cases/[caseId]', parent: 'area:support-cases', record: 'caseId' },
  // Work
  { id: 'create:work-item', scope: 'organization', kind: 'create', pattern: 'work/new', parent: 'area:work', label: 'New work' },
  { id: 'record:work-item', scope: 'organization', kind: 'record', pattern: 'work/[workItemId]', parent: 'area:work', record: 'workItemId', noun: 'work' },
  { id: 'view:dispatch', scope: 'organization', kind: 'view', pattern: 'work/dispatch', parent: 'workspace:field', label: 'Dispatch', open: 'P-2' },
  { id: 'record:resource', scope: 'organization', kind: 'record', pattern: 'resources/[resourceId]', parent: 'area:resources', record: 'resourceId', noun: 'resource' },
  { id: 'record:location', scope: 'organization', kind: 'record', pattern: 'locations/[locationId]', parent: 'area:locations', record: 'locationId', noun: 'location' },
  { id: 'record:asset', scope: 'organization', kind: 'record', pattern: 'assets/[assetId]', parent: 'area:assets', record: 'assetId' },
  // Finance
  { id: 'view:finance-search', scope: 'organization', kind: 'view', pattern: 'finance/search', parent: 'workspace:finance', label: 'Search', open: 'U-12' },
  { id: 'view:finance-reports', scope: 'organization', kind: 'view', pattern: 'finance/reports', parent: 'workspace:finance', label: 'Financial performance', open: 'U-12' },
  // Automations, AI, Studio
  { id: 'record:rule', scope: 'organization', kind: 'record', pattern: 'automations/[ruleId]', parent: 'area:automation-rules', record: 'ruleId' },
  { id: 'record:agent', scope: 'organization', kind: 'record', pattern: 'ai/agents/[agentId]', parent: 'target:ai-agents', record: 'agentId' },
  { id: 'record:form', scope: 'organization', kind: 'record', pattern: 'studio/forms/[formId]', parent: 'area:studio-forms', record: 'formId' },
  { id: 'view:form-responses', scope: 'organization', kind: 'view', pattern: 'studio/forms/[formId]/submissions', parent: 'record:form', label: 'Responses' },
  // Library: imports are Sources' history.
  { id: 'record:library-source', scope: 'organization', kind: 'record', pattern: 'library/sources/[resourceId]', parent: 'library:sources', record: 'resourceId' },
  { id: 'redirect:library-imports', scope: 'organization', kind: 'group', pattern: 'library/imports', redirect: true, label: 'Imports' },
  { id: 'create:import', scope: 'organization', kind: 'create', pattern: 'library/imports/new', parent: 'library:sources', label: 'Import customers' },
  { id: 'record:import-run', scope: 'organization', kind: 'record', pattern: 'library/imports/[runId]', parent: 'library:sources', record: 'runId' },
  // Help and Setup
  { id: 'record:help-article', scope: 'organization', kind: 'record', pattern: 'help/[slug]', parent: 'area:help', record: 'slug' },
  { id: 'view:help-contact', scope: 'organization', kind: 'view', pattern: 'help/contact', parent: 'area:help', label: 'Contact GildOps Support' },
  { id: 'view:setup-proposal', scope: 'organization', kind: 'view', pattern: 'setup/proposal', parent: 'area:setup', label: 'Proposed setup' },
  // Settings
  { id: 'view:access-members', scope: 'settings', kind: 'view', pattern: 'settings/access/members', parent: 'target:team', label: 'Members' },
  { id: 'view:access-invitations', scope: 'settings', kind: 'view', pattern: 'settings/access/invitations', parent: 'target:team', label: 'Invitations' },
  { id: 'view:access-roles', scope: 'settings', kind: 'view', pattern: 'settings/access/roles', parent: 'target:team', label: 'Roles' },
  { id: 'record:connection', scope: 'settings', kind: 'record', pattern: 'settings/connections/[connectionId]', parent: 'target:integrations', record: 'connectionId' },
  { id: 'record:connect-app', scope: 'settings', kind: 'create', pattern: 'settings/connections/apps/[applicationKey]', parent: 'target:integrations', record: 'applicationKey', recordLabel: (name) => `Connect ${name}` },
  { id: 'view:mcp-servers', scope: 'settings', kind: 'view', pattern: 'settings/connections/mcp', parent: 'target:integrations', label: 'MCP servers' },
  { id: 'state:service-paused', scope: 'settings', kind: 'state', pattern: 'settings/plan/locked', parent: 'target:plan', label: 'Service paused' },
  // Platform
  { id: 'record:platform-tenant', scope: 'platform', kind: 'record', pattern: 'organizations/[targetOrganizationId]', parent: 'platform:organizations', record: 'targetOrganizationId' },
  ...(['commercial', 'failures', 'integrations', 'providers', 'usage'] as const).map((tab): LocationNode => ({
    id: `view:platform-tenant-${tab}`, scope: 'platform', kind: 'view', pattern: `organizations/[targetOrganizationId]/${tab}`, parent: 'record:platform-tenant', label: tab.charAt(0).toUpperCase() + tab.slice(1), open: 'U-10',
  })),
  { id: 'view:platform-modules', scope: 'platform', kind: 'view', pattern: 'catalog/modules', parent: 'platform:products', label: 'Features', open: 'U-9' },
  { id: 'view:platform-line-items', scope: 'platform', kind: 'view', pattern: 'catalog/products', parent: 'platform:products', label: 'Line items', open: 'U-9' },
  { id: 'record:platform-product', scope: 'platform', kind: 'record', pattern: 'catalog/products/[productKey]', parent: 'platform:products', record: 'productKey' },
  { id: 'record:platform-family', scope: 'platform', kind: 'record', pattern: 'catalog/families/[familyKey]', parent: 'platform:products', record: 'familyKey' },
  { id: 'create:platform-connector', scope: 'platform', kind: 'create', pattern: 'integrations/new', parent: 'platform:connectors', label: 'New connector' },
  { id: 'record:platform-connector', scope: 'platform', kind: 'record', pattern: 'integrations/[connectorKey]', parent: 'platform:connectors', record: 'connectorKey' },
  { id: 'record:platform-provider', scope: 'platform', kind: 'record', pattern: 'providers/[providerKey]', parent: 'platform:providers', record: 'providerKey' },
  { id: 'view:platform-twilio', scope: 'platform', kind: 'view', pattern: 'providers/twilio', parent: 'platform:providers', label: 'Twilio' },
  { id: 'view:platform-twilio-configure', scope: 'platform', kind: 'view', pattern: 'providers/twilio/configure', parent: 'view:platform-twilio', label: 'Edit' },
  { id: 'record:platform-plan', scope: 'platform', kind: 'record', pattern: 'plans/[planKey]', parent: 'platform:plans', record: 'planKey' },
  { id: 'record:platform-tenant-economics', scope: 'platform', kind: 'record', pattern: 'economics/[targetOrganizationId]', parent: 'platform:portfolio-economics', record: 'targetOrganizationId' },
];

const areaRoute = (segment: string) => {
  const area = AREAS.find((candidate) => candidate.segment === segment);
  if (!area) throw new Error(`No area has the segment "${segment}".`);
  return area.route ?? area.segment;
};

/** A workspace has a Configuration level exactly when one of its own doors is a configuration page. */
function hasConfigurationLevel(workspace: WorkspaceKey): boolean {
  return (WORKSPACE_CONFIGURE[workspace] ?? []).some((door) => {
    const target = configTarget(door.target);
    return target.workspace === workspace && target.treatment !== 'operating';
  });
}

/**
 * Workspaces whose editors are reached from the page they configure and have no Configuration row,
 * so an editor's parent is that page rather than a "Configuration" level nobody can see. Work only for
 * now; Support's Queues and Service levels have the same shape and await their own navigation decision.
 */
const CONTEXTUAL_EDITOR_WORKSPACES: ReadonlySet<WorkspaceKey> = new Set(['field']);

function targetParent(target: ConfigTarget): string {
  return target.destination && target.workspace && CONTEXTUAL_EDITOR_WORKSPACES.has(target.workspace)
    ? `area:${target.destination}`
    : `configuration:${target.workspace}`;
}

function settingsTarget(target: ConfigTarget): boolean {
  return target.key !== 'setup' && (target.treatment === 'shared' || !target.workspace);
}

function deriveNodes(): LocationNode[] {
  const nodes: LocationNode[] = [
    { id: 'area:home', scope: 'organization', kind: 'home', pattern: areaRoute('home'), area: 'home' },
    { id: 'scope:settings', scope: 'settings', kind: 'group', pattern: areaRoute('settings'), label: 'Settings', redirect: true },
    { id: 'scope:personal', scope: 'personal', kind: 'group', pattern: null, label: 'Settings' },
    { id: 'scope:library', scope: 'organization', kind: 'group', pattern: areaRoute('library'), area: 'library', redirect: true },
  ];
  const workspaceHomes = new Set<string>(WORKSPACES.map((workspace) => workspace.home));
  // Setup is a lifecycle area that also has a configuration target; the area owns its location.
  const targetPaths = new Set(CONFIG_TARGETS.filter((target) => target.treatment !== 'operating' && target.key !== 'setup').map((target) => target.path));

  for (const workspace of WORKSPACES) {
    nodes.push({ id: `workspace:${workspace.key}`, scope: 'organization', kind: 'workspace', pattern: areaRoute(workspace.home), area: workspace.home, workspace: workspace.key });
    if (hasConfigurationLevel(workspace.key)) {
      // No workspace has a Configuration landing: the address only redirects to a door, so the level is plain text.
      nodes.push({ id: `configuration:${workspace.key}`, scope: 'organization', kind: 'configuration', pattern: `${areaRoute(workspace.home)}/configuration`, parent: `workspace:${workspace.key}`, workspace: workspace.key, label: 'Settings', redirect: true });
    }
  }

  for (const area of AREAS) {
    const route = area.route ?? area.segment;
    if (area.segment === 'home' || workspaceHomes.has(area.segment)) continue;
    // The configuration target at the same address owns it; its read-only use is an open decision (U-3).
    if (targetPaths.has(route)) continue;
    if (REDIRECT_AREAS.has(area.segment)) {
      if (area.segment !== 'library' && area.segment !== 'settings') nodes.push({ id: `area:${area.segment}`, scope: 'organization', kind: 'destination', pattern: route, area: area.segment, redirect: true });
      continue;
    }
    nodes.push({ id: `area:${area.segment}`, scope: 'organization', kind: 'destination', pattern: route, area: area.segment, workspace: area.workspace, ...(area.workspace ? { parent: area.segment === 'pipeline' ? 'area:customers' : `workspace:${area.workspace}` } : {}) });
  }

  for (const target of CONFIG_TARGETS) {
    if (target.treatment === 'operating' || target.key === 'setup') continue;
    if (settingsTarget(target)) {
      nodes.push({ id: `target:${target.key}`, scope: 'settings', kind: 'target', pattern: target.path, parent: 'scope:settings', target: target.key, open: OPEN_TARGETS[target.key], ...(target.path === 'settings/access' ? { redirect: true as const } : {}) });
    } else if (target.workspace) {
      nodes.push({ id: `target:${target.key}`, scope: 'organization', kind: 'target', pattern: target.path, parent: targetParent(target), target: target.key, workspace: target.workspace, open: OPEN_TARGETS[target.key] });
    }
  }

  for (const section of LIBRARY_SECTIONS) {
    nodes.push({ id: `library:${section.key}`, scope: 'organization', kind: 'destination', pattern: `library/${section.path}`, parent: 'scope:library', label: section.label });
  }
  for (const section of PERSONAL_SECTIONS) {
    nodes.push({ id: `personal:${section.key}`, scope: 'personal', kind: 'destination', pattern: section.path.replace(/^\//, ''), parent: 'scope:personal', label: section.label });
  }
  for (const destination of PLATFORM_DESTINATIONS) {
    nodes.push(destination.path === ''
      ? { id: `platform:${destination.key}`, scope: 'platform', kind: 'home', pattern: '', platform: destination.key, label: PLATFORM_ROOT_LABEL }
      : { id: `platform:${destination.key}`, scope: 'platform', kind: 'destination', pattern: destination.path, parent: `platform:${PLATFORM_DESTINATIONS[0].key}`, platform: destination.key });
  }
  return [...nodes, ...LOCATION_METADATA];
}

/** Every location the resolver recognizes, in registry order. Exported for coverage checks. */
export const LOCATION_NODES: readonly LocationNode[] = deriveNodes();
const NODE_BY_ID = new Map(LOCATION_NODES.map((node) => [node.id, node]));

/** A duplicate id or a dangling parent is a build mistake, not a runtime case to render around. */
function assertLocations(): void {
  const seen = new Set<string>();
  for (const node of LOCATION_NODES) {
    if (seen.has(node.id)) throw new Error(`Two locations have the id "${node.id}".`);
    seen.add(node.id);
    if (node.parent && !NODE_BY_ID.has(node.parent)) throw new Error(`Location "${node.id}" names a missing parent "${node.parent}".`);
  }
}
assertLocations();

export type LocationAccess = {
  /** The organization's entitlement, permission and work-shape facts — the same gate configuration uses. */
  gate?: ConfigGate;
  /** Live platform permissions, for Platform addresses. */
  platform?: ReadonlySet<PlatformCapability>;
};

/** `LocationAccess.gate` as the server hands it to the browser: the shell's own gate, as plain arrays. */
export type SerializedLocationAccess = { enabledModules: string[]; featureAvailability: string[]; capabilities: string[]; schedulableWork?: boolean };

export function serializeLocationAccess(gate: ConfigGate): SerializedLocationAccess {
  return {
    enabledModules: [...(gate.enabledModules ?? [])],
    featureAvailability: [...(gate.featureAvailability ?? [])],
    capabilities: [...(gate.capabilities ?? [])],
    ...(gate.schedulableWork === undefined ? {} : { schedulableWork: gate.schedulableWork }),
  };
}

export function locationAccessFrom(serialized: SerializedLocationAccess): LocationAccess {
  return { gate: { enabledModules: new Set(serialized.enabledModules), featureAvailability: new Set(serialized.featureAvailability), capabilities: new Set(serialized.capabilities as Capability[]), schedulableWork: serialized.schedulableWork } };
}

/**
 * The routes whose page location comes from this resolver today (ADR-047 migration). Every other
 * route keeps the location its page publishes itself. A route is in exactly one of the two
 * systems, so the header bar never has two publishers.
 */
export const RESOLVED_LOCATION_ROUTES: ReadonlySet<string> = new Set([
  ...WORKSPACES.map(workspace => `workspace:${workspace.key}`),
  // Slice 1B
  'area:customers', 'record:customer',
  // Slice 1C — CRM operating pages. The Opportunity pipeline (U-17) and CRM configuration (Batch 3) stay on their own trails.
  'workspace:crm', 'area:pipeline', 'area:opportunity-pipeline', 'area:opportunities', 'record:opportunity', 'area:follow-ups', 'area:calendar', 'area:crm-search',
]);

export function adoptsResolvedLocation(pathname: string): boolean {
  const location = resolveLocation({ pathname });
  return location.status === 'resolved' && RESOLVED_LOCATION_ROUTES.has(location.id);
}

export type LocationInput = {
  pathname: string;
  access?: LocationAccess;
  vocabulary?: BusinessProfile | null;
  /**
   * Server-loaded labels for this route's dynamic segments, by parameter name. A record that is
   * loading says so explicitly; one that is absent is reported in `incomplete` and shown as nothing,
   * never as a permanent "Loading…".
   */
  records?: Readonly<Record<string, RecordLabel>>;
  /** Set by a not-found page: the location is the nearest recognized ancestor of `pathname`. */
  state?: 'not-found';
  /** The authorized projection, only to report whether the sidebar shows the current page. */
  navigation?: readonly ShellSection[];
  /** The organization a personal Settings page was opened from, when there is one. */
  organizationId?: string | null;
};

export type LocationCrumb = { id: string; kind: LocationKind; label: string; href?: string; state?: 'loading' | 'unknown' };

export type ResolvedLocation = {
  status: 'resolved';
  id: string;
  scope: LocationScope;
  trail: LocationCrumb[];
  current: { id: string; kind: LocationKind; label: string; state: 'ready' | 'loading' | 'missing' | 'unknown' };
  /** Dynamic segments whose label the page did not supply: an integration gap, not a loading state. */
  incomplete: string[];
  /** The hierarchical Up destination: the last linked ancestor. Separate from browser history. */
  up?: string;
  /** Accessible name for the page's single `h1`. */
  headingName: string;
  owner: { scope: LocationScope; workspace?: WorkspaceKey; destination?: string; configTarget?: string };
  /** Outstanding decisions affecting this location. */
  open: string[];
  inNavigation?: boolean;
};

export type PageLocation = ResolvedLocation | { status: 'redirect'; id: string } | { status: 'unresolved'; pathname: string };

const LOADING_LABEL = 'Loading…';
const NOT_FOUND_LABEL = 'Not found';

type Root = { scope: 'organization' | 'personal' | 'platform'; base: string; segments: string[]; organizationId?: string };

function rootOf(pathname: string, organizationId?: string | null): Root | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  const organization = /^\/organizations\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (organization && organization[1] !== 'accept-invite') {
    return { scope: 'organization', base: `/organizations/${organization[1]}`, segments: organization[2] ? organization[2].split('/') : [], organizationId: organization[1] };
  }
  const platform = /^\/platform(?:\/(.*))?$/.exec(path);
  if (platform) return { scope: 'platform', base: '/platform', segments: platform[1] ? platform[1].split('/') : [] };
  if (path === '/settings/account' || path.startsWith('/settings/account/')) return { scope: 'personal', base: '', segments: path.slice(1).split('/'), organizationId: organizationId ?? undefined };
  return null;
}

const inRoot = (node: LocationNode, root: Root) => (root.scope === 'organization' ? node.scope === 'organization' || node.scope === 'settings' : node.scope === root.scope);

/** Static segments outrank dynamic ones, position by position, as the router does. */
function match(root: Root, segments: string[]): { node: LocationNode; params: Record<string, string> } | null {
  let best: { node: LocationNode; params: Record<string, string>; score: number[] } | null = null;
  for (const node of LOCATION_NODES) {
    if (node.pattern === null || !inRoot(node, root)) continue;
    const parts = node.pattern === '' ? [] : node.pattern.split('/');
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const score: number[] = [];
    let ok = true;
    for (let index = 0; index < parts.length; index++) {
      const dynamic = /^\[(\w+)\]$/.exec(parts[index]);
      if (dynamic) { params[dynamic[1]] = decodeURIComponent(segments[index]); score.push(1); }
      else if (parts[index] === segments[index]) score.push(2);
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (!best || outranks(score, best.score)) best = { node, params, score };
  }
  return best ? { node: best.node, params: best.params } : null;
}

/** The first position where two candidates differ decides: a static segment beats a dynamic one. */
function outranks(score: number[], other: number[]): boolean {
  const index = score.findIndex((value, position) => value !== other[position]);
  return index !== -1 && score[index] > other[index];
}

function chainOf(node: LocationNode): LocationNode[] {
  const chain: LocationNode[] = [];
  for (let at: LocationNode | undefined = node; at; at = at.parent ? NODE_BY_ID.get(at.parent) : undefined) chain.unshift(at);
  return chain;
}

function hrefOf(node: LocationNode, root: Root, params: Record<string, string>): string | undefined {
  if (node.pattern === null) return undefined;
  const path = node.pattern.replace(/\[(\w+)\]/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
  if (node.scope === 'personal') return `/${path}${root.organizationId ? `?org=${encodeURIComponent(root.organizationId)}` : ''}`;
  if (node.scope === 'platform') return `/platform${path ? `/${path}` : ''}`;
  return `${root.base}/${path}`;
}

function nounLabel(vocabulary: BusinessProfile | null | undefined, segment: string): string | undefined {
  const entity = DESTINATION_NOUNS[segment];
  return entity ? vocabulary?.nouns[entity]?.plural : undefined;
}

let settingsLabels: Map<string, string> | null = null;
function settingsLabel(path: string): string | undefined {
  // Labels and addresses from the Settings projection itself; an ungated projection lists every entry.
  settingsLabels ??= new Map(projectSettingsNav('_', {}).flatMap((section) => section.items).map((item) => [item.href.replace(/^\/organizations\/_\//, ''), item.label]));
  return settingsLabels.get(path);
}

function labelOf(node: LocationNode, vocabulary: BusinessProfile | null | undefined): string {
  if (node.kind === 'workspace') return WORKSPACES.find((workspace) => workspace.key === node.workspace)!.label;
  if (node.area) {
    const area = AREAS.find((candidate) => candidate.segment === node.area)!;
    return vocabulary?.labels[area.segment] ?? nounLabel(vocabulary, area.segment) ?? area.label;
  }
  if (node.target) {
    const target = configTarget(node.target);
    if (node.scope === 'settings') return settingsLabel(target.path) ?? SETTINGS_LABELS[target.key] ?? target.key;
    return WORKSPACE_CONFIGURE[target.workspace!]?.find((door) => door.target === target.key && !door.hash)?.label ?? target.key;
  }
  if (node.platform && node.kind !== 'home') return PLATFORM_DESTINATIONS.find((destination) => destination.key === node.platform)!.label;
  return node.label ?? node.id;
}

/** Whether this viewer may open the location — the registries' own predicates, never sidebar visibility. */
function opens(node: LocationNode, access: LocationAccess, organizationId: string | undefined): boolean {
  return !node.redirect && node.pattern !== null && permitted(node, access, organizationId);
}

/** The registry predicate for this location, or, for a record, view or section, its nearest governed ancestor's. */
function permitted(node: LocationNode, access: LocationAccess, organizationId: string | undefined): boolean {
  const gate = access.gate ?? {};
  const state = { enabled: gate.enabledModules, capabilities: gate.capabilities, featureAvailability: gate.featureAvailability, schedulableWork: gate.schedulableWork };
  if (node.kind === 'configuration') return workspaceConfigureItems(organizationId ?? '_', node.workspace!, gate).length > 0;
  if (node.target) return configTargetOffered(configTarget(node.target), gate);
  if (node.area) return areaAvailable(node.area, state);
  if (node.platform) {
    const destination = PLATFORM_DESTINATIONS.find((candidate) => candidate.key === node.platform)!;
    return !access.platform || access.platform.has(destination.requires);
  }
  // Records, sub-views and sections carry no predicate of their own; a grouping level grants nothing.
  const parent = node.parent ? NODE_BY_ID.get(node.parent) : undefined;
  return parent ? permitted(parent, access, organizationId) : true;
}

function ownerOf(chain: LocationNode[], scope: LocationScope): ResolvedLocation['owner'] {
  const workspace = [...chain].reverse().find((node) => node.workspace)?.workspace
    ?? chain.map((node) => (node.area ? AREAS.find((area) => area.segment === node.area)?.workspace : undefined)).find(Boolean);
  const destination = [...chain].reverse().find((node) => node.area)?.area;
  const configTargetKey = [...chain].reverse().find((node) => node.target)?.target;
  return { scope, ...(workspace ? { workspace } : {}), ...(destination ? { destination } : {}), ...(configTargetKey ? { configTarget: configTargetKey } : {}) };
}

function navigationHrefs(sections: readonly ShellSection[]): Set<string> {
  const hrefs = new Set<string>();
  const walk = (item: NavItem) => {
    hrefs.add(item.href.split(/[?#]/)[0]);
    for (const child of [...(item.children ?? []), ...(item.destinations ?? []), ...(item.configuration ? [item.configuration] : [])]) walk(child);
  };
  for (const section of sections) section.items.forEach(walk);
  return hrefs;
}

/** Resolve where `pathname` is. Unknown addresses are `unresolved`; nothing is invented for them. */
export function resolveLocation(input: LocationInput): PageLocation {
  const root = rootOf(input.pathname, input.organizationId);
  if (!root) return { status: 'unresolved', pathname: input.pathname };
  const access = input.access ?? {};

  let found = match(root, root.segments);
  let notFound = input.state === 'not-found';
  // A recognized page that refuses (a switched-off feature, a record it cannot show) keeps its own
  // registered ancestors; only an address nothing recognizes falls back to its nearest real prefix.
  const refusedHere = notFound && found !== null && !found.node.redirect;
  if (!refusedHere && (notFound || !found)) {
    if (!notFound) {
      // The bare organization address only redirects to Home.
      if (root.scope === 'organization' && root.segments.length === 0) return { status: 'redirect', id: 'organization-root' };
      return { status: 'unresolved', pathname: input.pathname };
    }
    // Not found: the nearest recognized ancestor that is a real page.
    found = null;
    for (let length = root.segments.length - 1; length >= 0 && !found; length--) {
      const candidate = match(root, root.segments.slice(0, length));
      if (candidate && !candidate.node.redirect) found = candidate;
    }
    if (!found && root.scope === 'organization') found = match(root, ['home']);
    if (!found) return { status: 'unresolved', pathname: input.pathname };
  }
  if (!found) return { status: 'unresolved', pathname: input.pathname };
  const { node, params } = found;
  if (node.redirect && !notFound) return { status: 'redirect', id: node.id };

  const chain = refusedHere ? chainOf(node).slice(0, -1) : chainOf(node);
  const trail: LocationCrumb[] = [];
  let current: ResolvedLocation['current'] | null = null;
  let recordName: string | undefined;

  const incomplete: string[] = [];
  for (const [index, step] of chain.entries()) {
    const last = index === chain.length - 1 && !notFound;
    const supplied = step.record ? input.records?.[step.record] : undefined;
    const record: RecordLabel | { state: 'unknown' } | null = step.record ? supplied ?? { state: 'unknown' } : null;
    if (record?.state === 'missing') {
      // A missing, deleted or undisclosed record ends the location here, without saying which it was.
      notFound = true;
      break;
    }
    if (record?.state === 'unknown') incomplete.push(step.record!);
    // An unsupplied label falls back to what kind of record this is, never to which one.
    const label = record?.state === 'ready' ? (step.recordLabel ?? ((value: string) => value))(record.label)
      : record?.state === 'loading' ? LOADING_LABEL
      : record?.state === 'unknown' ? (step.noun === 'customer' && !input.vocabulary?.nouns.customer ? 'Contact' : step.noun ? businessNoun(input.vocabulary ?? null, step.noun) : '')
      : last && step.kind === 'workspace' ? 'Dashboard' : labelOf(step, input.vocabulary);
    if (record?.state === 'ready' && step.kind === 'record') recordName = record.label;
    const pending = record?.state === 'loading' || record?.state === 'unknown' ? record.state : undefined;
    if (last) {
      current = { id: step.id, kind: step.kind, label, state: pending ?? 'ready' };
      break;
    }
    const href = pending ? undefined : opens(step, access, root.organizationId) ? hrefOf(step, root, params) : undefined;
    trail.push({ id: step.id, kind: step.kind, label, ...(href ? { href } : {}), ...(pending ? { state: pending } : {}) });
  }
  if (notFound || !current) current = { id: `${node.id}:not-found`, kind: 'state', label: NOT_FOUND_LABEL, state: 'missing' };

  const linked = [...trail].reverse().find((crumb) => crumb.href)?.href;
  const homeNode = NODE_BY_ID.get('area:home')!;
  // A workspace Home's way up is the organization's Home, the directory of workspaces.
  const fallbackUp = node.scope === 'organization' && current.id !== homeNode.id && opens(homeNode, access, root.organizationId) ? hrefOf(homeNode, root, {}) : undefined;
  const headingName = current.state === 'missing' ? NOT_FOUND_LABEL
    : current.state === 'loading' ? LOADING_LABEL
    : current.state === 'unknown' ? current.label
    : current.kind !== 'record' && recordName ? `${current.label} – ${recordName}` : current.label;
  const open = [...new Set(chain.map((step) => step.open).filter((value): value is string => Boolean(value)))];
  const resolved: ResolvedLocation = {
    status: 'resolved',
    id: current.state === 'missing' ? current.id : node.id,
    scope: node.scope,
    trail,
    current,
    ...(linked ?? fallbackUp ? { up: linked ?? fallbackUp } : {}),
    headingName,
    owner: ownerOf(chain, node.scope),
    open,
    incomplete,
  };
  if (input.navigation && current.state !== 'missing') resolved.inNavigation = navigationHrefs(input.navigation).has(hrefOf(node, root, params)!.split('?')[0]);
  return resolved;
}
