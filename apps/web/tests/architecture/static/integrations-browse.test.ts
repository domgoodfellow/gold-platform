import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browseFilterFrom,
  connectorAvailability,
  connectorCategories,
  connectorOperationalState,
  connectorsForFilter,
  filterConnectors,
  isConnectable,
  usesSignIn,
} from '@/lib/domain/integrations/connectors';
import type { ConnectorReadiness } from '@/lib/domain/integrations/readiness';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const SAMPLE = [
  { key: 'dropbox', name: 'Dropbox', suite: null, category: 'Files', description: 'Files and folders.', status: 'live' as const },
  { key: 'google_workspace', name: 'Google Workspace', suite: 'Google Workspace', category: 'Productivity', description: 'Drive and Calendar.', status: 'planned' as const },
  { key: 'notion', name: 'Notion', suite: null, category: 'Productivity', description: 'Pages.', status: 'beta' as const },
];

const READY: ConnectorReadiness = { implemented: true, configured: true, reason: null };
const UNCONFIGURED: ConnectorReadiness = { implemented: true, configured: false, reason: 'oauth_client_missing' };
const NO_ADAPTER: ConnectorReadiness = { implemented: false, configured: false, reason: 'adapter_missing' };

describe('browsing the connector catalogue', () => {
  it('lists categories in catalogue order, once each', () => {
    expect(connectorCategories(SAMPLE)).toEqual(['Files', 'Productivity']);
  });

  it('searches name, suite, category and description', () => {
    expect(filterConnectors(SAMPLE, { query: 'drive' }).map((c) => c.key)).toEqual(['google_workspace']);
    expect(filterConnectors(SAMPLE, { query: 'PRODUCTIVITY' }).map((c) => c.key)).toEqual(['google_workspace', 'notion']);
    expect(filterConnectors(SAMPLE, { category: 'Files' }).map((c) => c.key)).toEqual(['dropbox']);
    expect(filterConnectors(SAMPLE, { query: 'nothing here' })).toEqual([]);
  });
});

describe('what a business is offered is three independent facts', () => {
  it.each([
    ['planned', READY, false],
    ['beta', NO_ADAPTER, false],
    ['beta', UNCONFIGURED, false],
    ['beta', undefined, false], // the API did not answer: not offered, never guessed
    ['beta', READY, true],
    ['live', READY, true],
    ['live', UNCONFIGURED, false],
  ] as const)('%s + %j is connectable: %s', (status, readiness, expected) => {
    expect(isConnectable({ status }, readiness)).toBe(expected);
  });

  it('calls a planned connector upcoming and a promoted but inoperable one unavailable, never the same thing', () => {
    expect(connectorAvailability({ status: 'planned' }, READY)).toBe('upcoming');
    expect(connectorAvailability({ status: 'beta' }, UNCONFIGURED)).toBe('unavailable');
    expect(connectorAvailability({ status: 'beta' }, READY)).toBe('connectable');
  });

  it('tells an operator planned, adapter missing, configuration missing and operational apart', () => {
    expect(connectorOperationalState({ status: 'planned' }, undefined)).toBe('upcoming');
    expect(connectorOperationalState({ status: 'beta' }, NO_ADAPTER)).toBe('adapter_missing');
    expect(connectorOperationalState({ status: 'beta' }, UNCONFIGURED)).toBe('needs_setup');
    expect(connectorOperationalState({ status: 'beta' }, READY)).toBe('operational');
    expect(connectorOperationalState({ status: 'beta' }, undefined)).toBe('unknown');
  });

  it('knows how a connector authorizes from the catalogue, not from a list of keys', () => {
    expect(usesSignIn({ authMethod: 'oauth2' })).toBe(true);
    expect(usesSignIn({ authMethod: 'none' })).toBe(false);
  });
});

describe('Browse filters', () => {
  const connectors = [
    { key: 'slack', status: 'beta' as const },
    { key: 'dropbox', status: 'beta' as const },
    { key: 'hubspot', status: 'beta' as const },
    { key: 'shopify', status: 'planned' as const },
    { key: 'salesforce', status: 'planned' as const },
  ];
  const readiness = new Map<string, ConnectorReadiness>([
    ['slack', READY],
    ['dropbox', READY],
    ['hubspot', UNCONFIGURED],
  ]);
  const keys = (filter: 'available' | 'connected' | 'upcoming', connected: string[] = []) =>
    connectorsForFilter(connectors, { filter, readiness, connectedKeys: new Set(connected) }).map((c) => c.key);

  it('shows only what can be connected, and not yet connected, by default', () => {
    expect(browseFilterFrom(undefined)).toBe('available');
    expect(browseFilterFrom('nonsense')).toBe('available');
    expect(keys('available')).toEqual(['slack', 'dropbox']);
    expect(keys('available', ['slack'])).toEqual(['dropbox']);
  });

  it('puts planned connectors under Upcoming alone, and an unconfigured one nowhere', () => {
    expect(keys('upcoming')).toEqual(['shopify', 'salesforce']);
    expect(keys('available')).not.toContain('hubspot');
    expect(keys('upcoming')).not.toContain('hubspot');
    expect(keys('connected')).toEqual([]);
  });

  it('keeps a connected app under Connected even when this deployment can no longer connect it', () => {
    expect(keys('connected', ['hubspot', 'slack'])).toEqual(['slack', 'hubspot']);
  });
});

describe('the tenant Integrations screen owns no connector list', () => {
  it('reads the catalogue rather than a constant', () => {
    const page = read('app/organizations/[organizationId]/settings/connections/connections-page.tsx');
    expect(page).toContain('listConnectors');
    expect(page).not.toMatch(/\bCATALOG\b/);
    for (const name of ['Google Workspace', 'HubSpot', 'Shopify', 'Notion']) {
      expect(page, name).not.toContain(name);
    }
  });

  it('names a connector key in code only in the adapter registry', () => {
    const card = read('features/integrations/catalogue/connector-card.tsx');
    // Every key comes from data. A file format is not a connector, so no card has a bespoke form.
    expect(card).not.toMatch(/'csv'|Csv/);
    expect(card.match(/'[a-z0-9_]+'/g)?.filter((literal) => ['\'google_workspace\'', '\'hubspot\'', '\'notion\''].includes(literal)) ?? []).toEqual([]);
  });

  it('draws no control for what is not available, and no OAuth client detail for a business', () => {
    const card = read('features/integrations/catalogue/connector-card.tsx');
    const catalogue = read('features/integrations/catalogue/app-library.tsx');
    for (const file of [card, catalogue]) {
      expect(file).not.toMatch(/Coming soon|Not available yet/);
      expect(file).not.toMatch(/_OAUTH_|requiredConfiguration|client secret/i);
    }
    expect(card).not.toMatch(/disabled/);
  });

  it('asks the API what is connectable and keeps no registry of keys in the web runtime', () => {
    const page = read('app/organizations/[organizationId]/settings/connections/connections-page.tsx');
    expect(page).toContain('loadConnectorReadiness');
    expect(() => read('lib/adapters/integrations/index.ts')).toThrow();
  });

  it('keeps the card grid and the section nav from forcing a horizontal page scroll', () => {
    const catalogue = read('features/integrations/catalogue/app-library.tsx');
    const nav = read('features/integrations/integrations-nav.tsx');
    expect(catalogue).toContain('sm:grid-cols-2'); // one column at phone width
    expect(catalogue).toContain('flex-wrap'); // chips wrap
    // The scroll guarantee now lives in the shared ViewNav/tab-styles, not spelled out per caller.
    expect(nav).toContain('ViewNav');
    expect(read('../../packages/ui/src/components/tab-styles.ts')).toContain('overflow-x-auto');
  });
});
