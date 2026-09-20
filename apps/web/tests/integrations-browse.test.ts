import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectorCategories, filterConnectors, isConnectable } from '@/lib/domain/integrations/connectors';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const SAMPLE = [
  { key: 'csv', name: 'CSV / spreadsheet file', suite: null, category: 'Files', description: 'Upload an exported file.', status: 'live' as const },
  { key: 'google_workspace', name: 'Google Workspace', suite: 'Google Workspace', category: 'Productivity', description: 'Drive and Calendar.', status: 'planned' as const },
  { key: 'notion', name: 'Notion', suite: null, category: 'Productivity', description: 'Pages.', status: 'beta' as const },
];

describe('browsing the connector catalogue', () => {
  it('lists categories in catalogue order, once each', () => {
    expect(connectorCategories(SAMPLE)).toEqual(['Files', 'Productivity']);
  });

  it('searches name, suite, category and description, and narrows by category', () => {
    expect(filterConnectors(SAMPLE, { query: 'drive' }).map((c) => c.key)).toEqual(['google_workspace']);
    expect(filterConnectors(SAMPLE, { query: 'PRODUCTIVITY' }).map((c) => c.key)).toEqual(['google_workspace', 'notion']);
    expect(filterConnectors(SAMPLE, { category: 'Files' }).map((c) => c.key)).toEqual(['csv']);
    expect(filterConnectors(SAMPLE, { query: 'nothing here' })).toEqual([]);
    expect(filterConnectors(SAMPLE, {})).toHaveLength(3);
  });

  it('enables Connect only for a connector that is not planned and has an adapter', () => {
    expect(isConnectable(SAMPLE[0]!)).toBe(true); // csv: live and implemented
    expect(isConnectable(SAMPLE[1]!)).toBe(false); // planned
    expect(isConnectable(SAMPLE[2]!)).toBe(false); // beta, but no adapter — browsable, not connectable
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

  it('names a connector key in code only in the adapter registry and the CSV path', () => {
    const card = read('features/integrations/connector-card.tsx');
    // csv is the one connector with a bespoke connect form; every other key comes from data.
    expect(card.match(/'[a-z0-9_]+'/g)?.filter((literal) => ['\'google_workspace\'', '\'hubspot\'', '\'notion\''].includes(literal)) ?? []).toEqual([]);
  });

  it('keeps the card grid and the section nav from forcing a horizontal page scroll', () => {
    const page = read('app/organizations/[organizationId]/integrations/page.tsx');
    const nav = read('features/integrations/integrations-nav.tsx');
    expect(page).toContain('sm:grid-cols-2'); // one column at phone width
    expect(page).toContain('flex-wrap'); // chips wrap
    expect(nav).toContain('overflow-x-auto'); // the section nav scrolls inside itself
  });
});
