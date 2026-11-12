import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AREAS, CONFIG_TARGETS, MODULES } from '@/lib/navigation';
import { projectShell } from '@/lib/shell';
import { LOCATION_NODES, RESOLVED_LOCATION_ROUTES, adoptsResolvedLocation, locationAccessFrom, resolveLocation, serializeLocationAccess, type PageLocation, type ResolvedLocation } from '@/lib/route/page-location';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import type { PlatformCapability } from '@/lib/domain/platform/permissions';

/**
 * The page-location contract (ADR-047), checked against expected trails written in the Batch 1
 * review rather than against what the code happened to produce. Each case states where a person is,
 * which ancestors they may follow and where Up goes.
 */

const ORG = '/organizations/o';
const allCapabilities = new Set<Capability>([
  ...CONFIG_TARGETS.flatMap((target) => [...target.permission, ...(target.requiresAll ?? [])]),
  ...AREAS.flatMap((area) => area.relevantCapabilities ?? []),
]);
const everything = {
  enabledModules: new Set<string>(MODULES.map((module) => module.key)),
  featureAvailability: new Set<string>([...AREAS.flatMap((area) => area.featureKeys ?? []), ...CONFIG_TARGETS.flatMap((target) => target.featureKeys ?? [])]),
  capabilities: allCapabilities,
  schedulableWork: true,
};
const allPlatform = new Set<PlatformCapability>(['platform.health', 'platform.organizations', 'platform.catalogue', 'platform.providers', 'platform.commercial']);

function resolved(location: PageLocation): ResolvedLocation {
  if (location.status !== 'resolved') throw new Error(`Expected a resolved location, got ${JSON.stringify(location)}`);
  return location;
}
const at = (pathname: string, extra: Partial<Parameters<typeof resolveLocation>[0]> = {}) =>
  resolved(resolveLocation({ pathname, access: { gate: everything, platform: allPlatform }, ...extra }));
const trail = (location: ResolvedLocation) => location.trail.map((crumb) => (crumb.href ? `${crumb.label} → ${crumb.href}` : crumb.label));

describe('route recognition', () => {
  it('prefers a static segment over a dynamic one at the same position', () => {
    expect(at(`${ORG}/comms/inbox/new`).id).toBe('create:conversation');
    expect(at(`${ORG}/comms/inbox/c1`, { records: { conversationId: { state: 'ready', label: 'Ana' } } }).id).toBe('record:conversation');
    expect(at(`${ORG}/automations/rules`).id).toBe('area:automation-rules');
    expect(at(`${ORG}/automations/r1`, { records: { ruleId: { state: 'ready', label: 'Rain delay' } } }).id).toBe('record:rule');
    expect(at(`${ORG}/work/dispatch`).id).toBe('view:dispatch');
    expect(at(`${ORG}/work/configuration`).id).toBe('target:work-configuration');
    expect(at(`${ORG}/crm/contacts/stages`).id).toBe('area:pipeline');
    expect(at('/platform/providers/twilio').id).toBe('view:platform-twilio');
    expect(at('/platform/integrations/new').id).toBe('create:platform-connector');
  });

  it('keeps Communications identity beside its Dashboard without a self-link', () => {
    const location = at(`${ORG}/comms`);
    expect(location.current.label).toBe('Dashboard');
    expect(location.trail).toContainEqual({ id: 'workspace:communications:identity', kind: 'group', label: 'Communications' });
    expect(location.up).toBe(`${ORG}/home`);
  });

  it('reports an unknown address as unresolved instead of inventing an ancestry', () => {
    expect(resolveLocation({ pathname: `${ORG}/nonsense` })).toEqual({ status: 'unresolved', pathname: `${ORG}/nonsense` });
    expect(resolveLocation({ pathname: `${ORG}/crm/contacts/a/b` }).status).toBe('unresolved');
    expect(resolveLocation({ pathname: '/elsewhere' }).status).toBe('unresolved');
    expect(resolveLocation({ pathname: '/organizations/accept-invite/t' }).status).toBe('unresolved');
  });

  it('gives redirect-only addresses no location of their own', () => {
    for (const path of ['', '/settings', '/library', '/insights', '/pricing', '/settings/access', '/library/imports']) {
      expect(resolveLocation({ pathname: `${ORG}${path}` }).status, path).toBe('redirect');
    }
  });
});

describe('every location is a real page, and every shell page has a location', () => {
  const app = fileURLToPath(new URL('../../app/', import.meta.url));
  const roots = { organization: join(app, 'organizations', '[organizationId]'), settings: join(app, 'organizations', '[organizationId]'), platform: join(app, 'platform'), personal: app };

  /**
   * The page file the router would serve for a pattern, or null. A static segment tries its own
   * folder first and then a dynamic one, as the router does when the static folder has no page.
   */
  function pageFor(directory: string, pattern: string): string | null {
    const [part, ...rest] = pattern ? pattern.split('/') : [];
    if (part === undefined) {
      const page = join(directory, 'page.tsx');
      return existsSync(page) ? page : null;
    }
    const children = readdirSync(directory).filter((name) => statSync(join(directory, name)).isDirectory());
    const candidates = /^\[\w+\]$/.test(part) ? children.filter((name) => name === part) : [...children.filter((name) => name === part), ...children.filter((name) => /^\[\w+\]$/.test(name))];
    for (const candidate of candidates) {
      const page = pageFor(join(directory, candidate), rest.join('/'));
      if (page) return page;
    }
    return null;
  }

  const served = new Set<string>();
  it('maps each location pattern to an existing page file', () => {
    const missing: string[] = [];
    for (const node of LOCATION_NODES) {
      if (node.pattern === null) continue;
      const page = pageFor(roots[node.scope], node.pattern);
      if (page) served.add(page);
      else missing.push(`${node.id} (${node.pattern})`);
    }
    expect(missing).toEqual([]);
  });

  it('leaves out only redirect-only and catch-all pages', () => {
    const pages: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === 'page.tsx') pages.push(path);
      }
    };
    walk(roots.organization);
    walk(roots.platform);
    walk(join(app, 'settings', 'account'));
    const uncovered = pages.filter((page) => !served.has(page)).map((page) => relative(app, page).replace(/\\/g, '/').replace(/\/page\.tsx$/, ''));
    // Catch-alls render not-found; the bare organization address is answered as a redirect directly;
    // the rest are redirect-only files with no registry entry (Phase 1 inventory, LEG). Redirect-only
    // areas (`calendar`, `fields`, `roles`, …) are recognized as redirects and so are not listed.
    const expected = [
      'organizations/[organizationId]', 'organizations/[organizationId]/[...unmatched]', 'platform/[...unmatched]',
      ...['customers', 'follow-ups', 'opportunities', 'sales'].map((legacy) => `organizations/[organizationId]/${legacy}/[[...legacyPath]]`),
      ...['comms/numbers', 'comms/numbers/[phoneNumberId]', 'finance/configuration', 'finance/economics', 'finance/economics/[targetOrganizationId]', 'finance/plans', 'finance/plans/[planKey]', 'insights/reports', 'integrations/[connectionId]', 'integrations/imports', 'integrations/imports/[runId]', 'integrations/imports/new', 'integrations/sources', 'integrations/sources/[resourceId]',
        'settings/calls', 'settings/commerce', 'settings/communications', 'settings/connections/apps', 'settings/data-automation', 'settings/opportunity-stages', 'settings/organization', 'settings/people', 'settings/pricing', 'settings/sales-stages', 'settings/website'].map((path) => `organizations/[organizationId]/${path}`),
    ];
    expect(uncovered.sort()).toEqual(expected.sort());
  });
});

describe('CRM collections and records', () => {
  it('places a collection beneath its workspace and goes up to the workspace Home', () => {
    const location = at(`${ORG}/crm/contacts`);
    expect(trail(location)).toEqual([`CRM → ${ORG}/crm`]);
    expect(location.current).toMatchObject({ label: 'Contacts', state: 'ready' });
    expect(location.up).toBe(`${ORG}/crm`);
    expect(location.owner).toMatchObject({ workspace: 'crm', destination: 'customers' });
  });

  it('names a record from server-loaded data and goes up to its collection', () => {
    const location = at(`${ORG}/crm/contacts/c1`, { records: { contactId: { state: 'ready', label: 'Acme Ltd' } } });
    expect(trail(location)).toEqual([`CRM → ${ORG}/crm`, `Contacts → ${ORG}/crm/contacts`]);
    expect(location.current.label).toBe('Acme Ltd');
    expect(location.headingName).toBe('Acme Ltd');
    expect(location.up).toBe(`${ORG}/crm/contacts`);
  });

  it('keeps known ancestors while the record name loads, without inventing one', () => {
    const location = at(`${ORG}/crm/contacts/c1`, { records: { contactId: { state: 'loading' } } });
    expect(trail(location)).toEqual([`CRM → ${ORG}/crm`, `Contacts → ${ORG}/crm/contacts`]);
    expect(location.current).toMatchObject({ label: 'Loading…', state: 'loading' });
    expect(location.headingName).toBe('Loading…');
    expect(location.incomplete).toEqual([]);
  });

  it('reports a record label nobody supplied, falling back to the record’s kind rather than loading or blank', () => {
    const location = at(`${ORG}/crm/contacts/c1`);
    expect(trail(location)).toEqual([`CRM → ${ORG}/crm`, `Contacts → ${ORG}/crm/contacts`]);
    expect(location.current).toMatchObject({ label: 'Contact', state: 'unknown' });
    expect(location.headingName).toBe('Contact');
    expect(location.incomplete).toEqual(['contactId']);
    const renamed = at(`${ORG}/crm/contacts/c1`, { vocabulary: { revision: 1, navigation: [], labels: {}, nouns: { customer: { singular: 'Client', plural: 'Clients' } } } });
    expect(renamed.current.label).toBe('Client');
  });

  it('lists only locations the resolver recognizes as real pages', () => {
    const ids = new Set(LOCATION_NODES.filter((node) => node.pattern !== null && !node.redirect).map((node) => node.id));
    expect([...RESOLVED_LOCATION_ROUTES].filter((id) => !ids.has(id))).toEqual([]);
  });

  it('gives every migrated record route a kind to fall back to', () => {
    const missing = LOCATION_NODES.filter((node) => RESOLVED_LOCATION_ROUTES.has(node.id) && node.record && !node.noun).map((node) => node.id);
    expect(missing).toEqual([]);
  });

  it('shows a missing or undisclosed record as not found inside its ancestors', () => {
    const location = at(`${ORG}/crm/contacts/c1`, { records: { contactId: { state: 'missing' } } });
    expect(trail(location)).toEqual([`CRM → ${ORG}/crm`, `Contacts → ${ORG}/crm/contacts`]);
    expect(location.current).toMatchObject({ label: 'Not found', state: 'missing', kind: 'state' });
    expect(location.up).toBe(`${ORG}/crm/contacts`);
  });

  it('links a parent the sidebar hides when the viewer may open it', () => {
    const navigation = projectShell({ organizationId: 'o', ...everything });
    const collection = at(`${ORG}/crm/opportunities`, { navigation });
    expect(collection.inNavigation).toBe(false);
    const record = at(`${ORG}/crm/opportunities/x`, { records: { opportunityId: { state: 'ready', label: 'Roof refit' } } });
    expect(trail(record)).toEqual([`CRM → ${ORG}/crm`, `Opportunities → ${ORG}/crm/opportunities`]);
    expect(record.up).toBe(`${ORG}/crm/opportunities`);
    expect(at(`${ORG}/crm/contacts`, { navigation }).inNavigation).toBe(true);
  });

  it('goes up from a workspace Home to the organization Home', () => {
    const location = at(`${ORG}/crm`);
    expect(location.trail).toEqual([]);
    expect(location.current.label).toBe('Dashboard');
    expect(location.up).toBe(`${ORG}/home`);
    expect(at(`${ORG}/home`).up).toBeUndefined();
  });
});

describe('Communications and the Dialer', () => {
  it('places the Dialer and a call record in Communications', () => {
    expect(trail(at(`${ORG}/calls`))).toEqual([`Communications → ${ORG}/comms`]);
    expect(at(`${ORG}/calls`).current.label).toBe('Dialer');
    const call = at(`${ORG}/calls/k1`, { records: { callId: { state: 'ready', label: 'Ana Silva' } } });
    expect(trail(call)).toEqual([`Communications → ${ORG}/comms`, `Dialer → ${ORG}/calls`]);
  });

  it('places a configuration record beneath its target and the plain-text Configuration level', () => {
    const number = at(`${ORG}/comms/configuration/numbers/n1`, { records: { phoneNumberId: { state: 'ready', label: '+1 555 0100' } } });
    expect(trail(number)).toEqual([`Communications → ${ORG}/comms`, 'Settings', `Numbers & assignments → ${ORG}/comms/configuration/numbers`]);
    expect(number.open).toContain('U-3');
  });

  it('leaves the workspace as plain text for a member who may configure it but not operate it', () => {
    const gate = { ...everything, capabilities: new Set<Capability>(['organization.manage']) };
    const location = resolved(resolveLocation({ pathname: `${ORG}/comms/configuration/calling`, access: { gate } }));
    expect(trail(location)).toEqual(['Communications', 'Settings']);
    expect(location.current.label).toBe('Calling & routing');
    // Neither ancestor is a page this member may open, so Up goes to the organization Home.
    expect(location.up).toBe(`${ORG}/home`);
  });
});

describe('configuration with known ownership', () => {
  it('keeps one canonical location however the page was reached, under the page it configures', () => {
    const location = at(`${ORG}/schedule/configuration`);
    // Work has no Configuration row, so its editors sit under the destination they configure, never a Configuration level.
    expect(trail(location)).toEqual([`Work → ${ORG}/field`, `Schedule → ${ORG}/schedule`]);
    expect(location.current.label).toBe('Scheduling & hours');
    expect(location.up).toBe(`${ORG}/schedule`);
    expect(location.owner).toMatchObject({ workspace: 'field', configTarget: 'schedule-configuration' });
  });

  it('puts the Work type editor under Work items, and Up returns there', () => {
    const gate = { ...everything, capabilities: new Set<Capability>(['field.manage']), schedulableWork: false };
    const location = resolved(resolveLocation({ pathname: `${ORG}/work/configuration`, access: { gate } }));
    expect(trail(location)).toEqual([`Work → ${ORG}/field`, `Work items → ${ORG}/work`]);
    expect(location.current.label).toBe('Work types & workflow');
    expect(location.up).toBe(`${ORG}/work`);
  });

  it("names the Work editors' parents with the business's own words, never renaming the workspace", () => {
    const vocabulary = { revision: 1, navigation: [], nouns: {}, labels: { work: 'Jobs', schedule: 'Diary', field: 'Operations' } };
    expect(trail(at(`${ORG}/work/configuration`, { vocabulary }))).toEqual([`Work → ${ORG}/field`, `Jobs → ${ORG}/work`]);
    expect(trail(at(`${ORG}/schedule/configuration`, { vocabulary }))).toEqual([`Work → ${ORG}/field`, `Diary → ${ORG}/schedule`]);
  });

  it('keeps the legacy Work configuration address as a redirect that no Work page names as an ancestor', () => {
    expect(LOCATION_NODES.find((node) => node.id === 'configuration:field')).toMatchObject({ pattern: 'field/configuration', redirect: true });
    expect(LOCATION_NODES.filter((node) => node.parent === 'configuration:field')).toEqual([]);
  });

  it('marks configuration whose ownership is still under review', () => {
    expect(at(`${ORG}/support/configuration/queues`).open).toContain('B-D5');
    expect(at(`${ORG}/ai/agents/a1`, { records: { agentId: { state: 'ready', label: 'Receptionist' } } }).open).toContain('U-5');
  });
});

describe('nested Studio forms', () => {
  it('links the form between Forms and its responses, and goes up to the form', () => {
    const location = at(`${ORG}/studio/forms/f1/submissions`, { records: { formId: { state: 'ready', label: 'Quote request' } } });
    expect(trail(location)).toEqual([`Studio → ${ORG}/studio`, `Forms → ${ORG}/studio/forms`, `Quote request → ${ORG}/studio/forms/f1`]);
    expect(location.current.label).toBe('Responses');
    expect(location.headingName).toBe('Responses – Quote request');
    expect(location.up).toBe(`${ORG}/studio/forms/f1`);
  });

  it('ends at not found when the form is missing', () => {
    const location = at(`${ORG}/studio/forms/f1/submissions`, { records: { formId: { state: 'missing' } } });
    expect(trail(location)).toEqual([`Studio → ${ORG}/studio`, `Forms → ${ORG}/studio/forms`]);
    expect(location.current.state).toBe('missing');
  });

  it('does not link a record ancestor whose name is still loading', () => {
    const location = at(`${ORG}/studio/forms/f1/submissions`, { records: { formId: { state: 'loading' } } });
    expect(location.trail[2]).toMatchObject({ label: 'Loading…', state: 'loading' });
    expect(location.trail[2].href).toBeUndefined();
    expect(location.up).toBe(`${ORG}/studio/forms`);
  });

  it('does not link or name a record ancestor whose label was never supplied', () => {
    const location = at(`${ORG}/studio/forms/f1/submissions`);
    expect(location.trail[2]).toMatchObject({ label: '', state: 'unknown' });
    expect(location.trail[2].href).toBeUndefined();
    expect(location.incomplete).toEqual(['formId']);
  });
});

describe('Organization Settings', () => {
  it('shows Settings as a plain-text level, since it has no index page', () => {
    const location = at(`${ORG}/settings/branding`);
    expect(trail(location)).toEqual(['Settings']);
    expect(location.current.label).toBe('Branding');
    expect(location.scope).toBe('settings');
    expect(location.up).toBeUndefined();
  });

  it('keeps Access as plain text above its routed views', () => {
    expect(trail(at(`${ORG}/settings/access/members`))).toEqual(['Settings', 'Access']);
  });

  it('links Roles & permissions above a role and a new role', () => {
    const roles = `Roles & permissions → ${ORG}/settings/access/roles`;
    expect(trail(at(`${ORG}/settings/access/roles/r1`, { records: { roleId: { state: 'ready', label: 'Dispatcher' } } }))).toEqual(['Settings', 'Access', roles]);
    expect(at(`${ORG}/settings/access/roles/new`).current.label).toBe('New role');
    expect(at(`${ORG}/settings/access/history`).current.label).toBe('Access history');
  });

  it('links Connections above a connection and an app being connected', () => {
    expect(trail(at(`${ORG}/settings/connections/c1`, { records: { connectionId: { state: 'ready', label: 'QuickBooks' } } }))).toEqual(['Settings', `Connections → ${ORG}/settings/connections`]);
    expect(at(`${ORG}/settings/connections/apps/slack`, { records: { applicationKey: { state: 'ready', label: 'Slack' } } }).current.label).toBe('Connect Slack');
  });

  it('places the public profile in Settings, not Studio (D3)', () => {
    const location = at(`${ORG}/settings/public-profile`);
    expect(trail(location)).toEqual(['Settings']);
    expect(location.current.label).toBe('Public profile');
  });

  it('places personal pages in Settings with or without an organization', () => {
    const personal = resolved(resolveLocation({ pathname: '/settings/account/appearance', organizationId: 'o' }));
    expect(trail(personal)).toEqual(['Settings']);
    expect(personal.current.label).toBe('Appearance');
    expect(personal.scope).toBe('personal');
  });
});

describe('Platform', () => {
  it('starts at Platform and leaves out group headings that have no page', () => {
    const location = at('/platform/plans/base', { records: { planKey: { state: 'ready', label: 'Base' } } });
    expect(trail(location)).toEqual(['Platform → /platform', 'Plans & Add-ons → /platform/plans']);
    expect(location.trail.map((crumb) => crumb.label)).not.toContain('Commercial administration');
    expect(location.trail.map((crumb) => crumb.label)).not.toContain('Administration');
  });

  it('links only the Platform pages this person may open', () => {
    const location = resolved(resolveLocation({ pathname: '/platform/plans/base', access: { platform: new Set<PlatformCapability>(['platform.commercial']) }, records: { planKey: { state: 'ready', label: 'Base' } } }));
    expect(trail(location)).toEqual(['Platform', 'Plans & Add-ons → /platform/plans']);
  });
});

describe('not-found and state pages', () => {
  it('keeps the nearest recognized ancestor for an unknown address beneath a workspace', () => {
    const location = at(`${ORG}/crm/nonsense`, { state: 'not-found' });
    expect(trail(location)).toEqual([`CRM → ${ORG}/crm`]);
    expect(location.current).toMatchObject({ label: 'Not found', state: 'missing' });
  });

  it('keeps the registered ancestors of a recognized page that refuses, not a URL prefix', () => {
    // Follow-ups lives at /crm/tasks but belongs to CRM; when the feature is off the page refuses.
    const location = at(`${ORG}/crm/tasks`, { state: 'not-found' });
    expect(trail(location)).toEqual([`CRM → ${ORG}/crm`]);
    expect(location.current).toMatchObject({ label: 'Not found', state: 'missing' });
  });

  it('falls back to the organization Home for an address that matches nothing', () => {
    expect(trail(at(`${ORG}/zzz`, { state: 'not-found' }))).toEqual([`Home → ${ORG}/home`]);
  });

  it('places a paused service beneath Plan & usage', () => {
    const location = at(`${ORG}/settings/plan/locked`);
    expect(trail(location)).toEqual(['Settings', `Plan & usage → ${ORG}/settings/plan`]);
    expect(location.current).toMatchObject({ kind: 'state', label: 'Service paused' });
  });
});

describe('the migration boundary', () => {
  it('adopts the resolver only on the pilot routes', () => {
    expect(adoptsResolvedLocation(`${ORG}/crm/contacts`)).toBe(true);
    expect(adoptsResolvedLocation(`${ORG}/crm/contacts/c1`)).toBe(true);
    // Slice 1C: CRM operating pages, but neither the Opportunity pipeline (U-17) nor CRM configuration (Batch 3).
    for (const path of ['/crm', '/crm/pipeline', '/crm/contacts/stages', '/crm/opportunities', '/crm/opportunities/o1', '/crm/tasks', '/crm/calendar', '/crm/search']) {
      expect(adoptsResolvedLocation(`${ORG}${path}`), path).toBe(true);
    }
    for (const path of ['/crm/configuration', '/crm/configuration/relationship-stages', '/crm/configuration/fields']) {
      expect(adoptsResolvedLocation(`${ORG}${path}`), path).toBe(false);
    }
    expect(adoptsResolvedLocation(`${ORG}/calls`)).toBe(false);
    expect(adoptsResolvedLocation(`${ORG}/settings/general`)).toBe(false);
    expect(adoptsResolvedLocation('/platform/plans')).toBe(false);
    expect(adoptsResolvedLocation(`${ORG}/nonsense`)).toBe(false);
  });

  it('round-trips the shell gate the server hands to the browser', () => {
    const access = locationAccessFrom(serializeLocationAccess(everything));
    expect(at(`${ORG}/crm/opportunities/x`, { records: { opportunityId: { state: 'ready', label: 'Roof refit' } } }).trail)
      .toEqual(resolved(resolveLocation({ pathname: `${ORG}/crm/opportunities/x`, access, records: { opportunityId: { state: 'ready', label: 'Roof refit' } } })).trail);
  });
});

describe('business vocabulary (A2)', () => {
  const vocabulary = { revision: 1, navigation: [], nouns: { customer: { singular: 'Client', plural: 'Clients' } }, labels: { work: 'Jobs', field: 'Operations' } };

  it('renames destinations by key and never renames the workspace', () => {
    const location = at(`${ORG}/work/w1`, { vocabulary, records: { workItemId: { state: 'ready', label: 'Boiler service' } } });
    expect(trail(location)).toEqual([`Work → ${ORG}/field`, `Jobs → ${ORG}/work`]);
    expect(at(`${ORG}/crm/contacts`, { vocabulary }).current.label).toBe('Clients');
  });

  it('never renames a record title', () => {
    const location = at(`${ORG}/crm/contacts/c1`, { vocabulary, records: { contactId: { state: 'ready', label: 'Contacts Unlimited' } } });
    expect(location.current.label).toBe('Contacts Unlimited');
  });
});
