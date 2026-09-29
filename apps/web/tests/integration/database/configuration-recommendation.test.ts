import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { previewByWorkspace, recommendConfiguration } from '@/lib/domain/customers/configuration-recommendation';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Recommends real catalogue Features from discovery answers (Slice 6). Runs against the real,
 * seeded `platform_catalog_*` tables rather than a fixture, since the whole point is never to
 * recommend a Feature that does not really exist or that is not really usable yet.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

let db: SupabaseClient;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `rec-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;

  db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  await foundBusiness({ ownerEmail: email, name: 'Recommendation Ltd', currency: 'EUR' });
});

describe('configuration recommendation', () => {
  it('recommends nothing for an empty discovery snapshot', async () => {
    const recommendation = await recommendConfiguration(db, { answers: {} });
    expect(recommendation.recommended).toEqual([]);
    expect(recommendation.notNeeded).toEqual([]);
  });

  it('recommends real, buildable catalogue Features from an answered requirement', async () => {
    const recommendation = await recommendConfiguration(db, {
      answers: {
        bookingIntake: { value: 'Books online.', status: 'confirmed', source: 'Owner', updatedAt: new Date().toISOString() },
      },
    });

    const keys = recommendation.recommended.map((entry) => entry.featureKey);
    expect(keys).toContain('booking');
    // Every recommended entry names a real Product and Module label, not a blank placeholder.
    for (const entry of recommendation.recommended) {
      expect(entry.productLabel.length).toBeGreaterThan(0);
      expect(entry.moduleLabel.length).toBeGreaterThan(0);
    }
  });

  it('never recommends a Feature that is only planned, not built', async () => {
    // `contact_forms` is seeded `planned` under studio/forms_intake at the time of writing; this
    // proves the rule generally, by checking no recommended or optional entry is ever `planned`,
    // rather than pinning one feature key that a future catalogue edit could quietly flip.
    const recommendation = await recommendConfiguration(db, {
      answers: {
        websiteSurfaces: { value: 'Needs a contact form.', status: 'confirmed', source: 'Owner', updatedAt: new Date().toISOString() },
      },
    });
    const { data: planned } = await db.from('platform_catalog_features').select('key').eq('implementation_state', 'planned');
    const plannedKeys = new Set((planned ?? []).map((row: { key: string }) => row.key));

    for (const entry of [...recommendation.recommended, ...recommendation.optional]) {
      expect(plannedKeys.has(entry.featureKey)).toBe(false);
    }
  });

  it('puts a not_applicable requirement\'s Features in notNeeded, never in recommended', async () => {
    const recommendation = await recommendConfiguration(db, {
      answers: {
        customerSelfService: { value: '', status: 'not_applicable', source: 'Owner', updatedAt: new Date().toISOString() },
      },
    });
    const notNeededKeys = recommendation.notNeeded.map((entry) => entry.featureKey);
    expect(notNeededKeys).toContain('portal_auth');
    expect(recommendation.recommended.map((entry) => entry.featureKey)).not.toContain('portal_auth');
  });

  it('lets an answered requirement outrank a conflicting not_applicable one', async () => {
    // Same Feature reachable from two requirements: one confirmed, one marked not applicable.
    // A real answer anywhere wins over an absence of one.
    const recommendation = await recommendConfiguration(db, {
      answers: {
        postContactWorkflow: { value: 'Sends a text.', status: 'confirmed', source: 'Owner', updatedAt: new Date().toISOString() },
        automationGoals: { value: '', status: 'not_applicable', source: 'Owner', updatedAt: new Date().toISOString() },
      },
    });
    // rule_authoring is mapped from both postContactWorkflow (answered) and automationGoals (not applicable).
    expect(recommendation.recommended.map((entry) => entry.featureKey)).toContain('rule_authoring');
    expect(recommendation.notNeeded.map((entry) => entry.featureKey)).not.toContain('rule_authoring');
  });

  it('groups the recommended set under the real operator workspace it would appear in', async () => {
    const recommendation = await recommendConfiguration(db, {
      answers: {
        bookingIntake: { value: 'Books online.', status: 'confirmed', source: 'Owner', updatedAt: new Date().toISOString() },
      },
    });
    const preview = previewByWorkspace(recommendation.recommended);

    const studio = preview.find((entry) => entry.workspace === 'studio');
    expect(studio).toBeDefined();
    expect(studio!.label).toBe('Studio');
    expect(studio!.entries.map((entry) => entry.featureKey)).toContain('booking');

    // Every workspace present names a real, non-empty entry list — no empty row drawn.
    for (const entry of preview) {
      expect(entry.entries.length).toBeGreaterThan(0);
    }
  });

  it('groups nothing when nothing is recommended', () => {
    expect(previewByWorkspace([])).toEqual([]);
  });
});
