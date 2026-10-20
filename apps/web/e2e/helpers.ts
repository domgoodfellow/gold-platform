import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DemoContext } from './global-setup';
import { createClient } from '@supabase/supabase-js';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';

/**
 * Where the context and signed-in browser states live. The demo setup writes them beside this file;
 * the isolated setup (`isolated-setup.ts`) writes its own, for disposable businesses, into
 * `E2E_FIXTURE_DIR` so a run never reads or overwrites the shared demo ones.
 */
const FIXTURE_DIR = process.env.E2E_FIXTURE_DIR ?? __dirname;

/** What `global-setup.ts` (or `isolated-setup.ts`) wrote, for a spec to read without re-deriving it via the UI. */
export function loadDemoContext(): DemoContext {
  const file = path.join(FIXTURE_DIR, '.demo-context.json');
  return JSON.parse(readFileSync(file, 'utf8')) as DemoContext;
}

/** A canonical address in the standalone Platform control plane. */
export function platformUrl(subpath = ''): string {
  return `/platform${subpath ? `/${subpath}` : ''}`;
}

/** GOLD's own Finance workspace — ordinary tenant Finance, like any business's. Plans & Add-ons is Platform's (`platformUrl('plans')`). */
export function financeUrl(subpath = ''): string {
  return `/organizations/${loadDemoContext().goldOrganizationId}/finance${subpath ? `/${subpath}` : ''}`;
}

export const OWNER_STORAGE_STATE = path.join(FIXTURE_DIR, '.auth', 'owner.json');
export const STAFF_STORAGE_STATE = path.join(FIXTURE_DIR, '.auth', 'staff.json');
/** The demo's own reduced-role colleague (`business.member` in `scripts/demo/businesses.ts`) — signed in with no `role.manage` and no `customer.create`. */
export const COLLEAGUE_STORAGE_STATE = path.join(FIXTURE_DIR, '.auth', 'colleague.json');

/** Local acceptance tenants use the same staff provisioning door as real organizations. */
export async function provisionBrowserOrganization(name: string) {
  const url = process.env.SUPABASE_URL ?? '';
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Browser fixtures are local only.');
  const fresh = () => createClient(url, process.env.SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
  const staff = fresh();
  const owner = fresh();
  const { ownerEmail } = loadDemoContext();
  const staffLogin = await staff.auth.signInWithPassword({ email: 'staff@gold.test', password: DEMO_PASSWORD });
  const ownerLogin = await owner.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (staffLogin.error) throw staffLogin.error;
  if (ownerLogin.error) throw ownerLogin.error;
  const organizationId = await provisionOrganization(staff, { ownerEmail, name, currency: 'EUR', timezone: 'Europe/Amsterdam', displayName: 'Owner' });
  return { organizationId, owner };
}
