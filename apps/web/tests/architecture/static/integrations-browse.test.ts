import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectorCategories, filterConnectors, isConnectable } from '@/lib/domain/integrations/connectors';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const SAMPLE = [
  { key: 'dropbox', name: 'Dropbox', suite: null, category: 'Files', description: 'Files and folders.', status: 'live' as const },
  { key: 'google_workspace', name: 'Google Workspace', suite: 'Google Workspace', category: 'Productivity', description: 'Drive and Calendar.', status: 'planned' as const },
  { key: 'notion', name: 'Notion', suite: null, category: 'Productivity', description: 'Pages.', status: 'beta' as const },
];

describe('browsing the connector catalogue', () => {
  beforeEach(() => {
    vi.stubEnv('GOLD_API_URL', 'https://api.example.test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists categories in catalogue order, once each', () => {
    expect(connectorCategories(SAMPLE)).toEqual(['Files', 'Productivity']);
  });

  it('searches name, suite, category and description, and narrows by category', () => {
    expect(filterConnectors(SAMPLE, { query: 'drive' }).map((c) => c.key)).toEqual(['google_workspace']);
    expect(filterConnectors(SAMPLE, { query: 'PRODUCTIVITY' }).map((c) => c.key)).toEqual(['google_workspace', 'notion']);
    expect(filterConnectors(SAMPLE, { category: 'Files' }).map((c) => c.key)).toEqual(['dropbox']);
    expect(filterConnectors(SAMPLE, { query: 'nothing here' })).toEqual([]);
    expect(filterConnectors(SAMPLE, {})).toHaveLength(3);
  });

  it('enables Connect only for a connector that is not planned and has an adapter', () => {
    expect(isConnectable(SAMPLE[0]!)).toBe(true); // dropbox: live, and an adapter runs where an API is configured
    expect(isConnectable(SAMPLE[1]!)).toBe(false); // planned
    expect(isConnectable({ key: 'shopify', status: 'beta' })).toBe(false); // beta, but no adapter — browsable, not connectable
  });
});

describe('the tenant Integrations screen owns no connector list', () => {
  it('reads the catalogue rather than a constant', () => {
    const page = read('app/organizations/[organizationId]/integrations/page.tsx');
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

  it('keeps the card grid and the section nav from forcing a horizontal page scroll', () => {
    const catalogue = read('features/integrations/catalogue/connector-catalogue.tsx');
    const nav = read('features/integrations/integrations-nav.tsx');
    expect(catalogue).toContain('sm:grid-cols-2'); // one column at phone width
    expect(catalogue).toContain('flex-wrap'); // chips wrap
    // The scroll guarantee now lives in the shared ViewNav/tab-styles, not spelled out per caller.
    expect(nav).toContain('ViewNav');
    expect(read('../../packages/ui/src/components/tab-styles.ts')).toContain('overflow-x-auto');
  });
});
