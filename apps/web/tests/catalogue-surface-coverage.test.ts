import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_SURFACE_COVERAGE } from '@/lib/catalogue-surface-coverage';

describe('catalogue implementation evidence', () => {
  it('uses one qualified key per available or partial feature', () => {
    const keys = CATALOGUE_SURFACE_COVERAGE.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.split('.').length === 3)).toBe(true);
  });

  it('points only at implementation evidence that exists', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    for (const entry of CATALOGUE_SURFACE_COVERAGE) {
      expect(entry.evidence.length, `${entry.key} has no evidence`).toBeGreaterThan(0);
      for (const file of entry.evidence) {
        expect(existsSync(path.join(root, file)), `${entry.key}: missing ${file}`).toBe(true);
      }
    }
  });

  it('keeps known catalogue overstatements explicit', () => {
    const ownership = CATALOGUE_SURFACE_COVERAGE.find((entry) => entry.key === 'crm.customers_contacts.ownership_assignment');
    const inventory = CATALOGUE_SURFACE_COVERAGE.find((entry) => entry.key === 'communications.voice.number_inventory');
    expect(ownership).toMatchObject({ catalogueState: 'available', domain: 'none', ui: 'none' });
    expect(inventory).toMatchObject({ catalogueState: 'available', ui: 'none' });
  });
});
