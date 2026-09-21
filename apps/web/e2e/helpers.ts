import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DemoContext } from './global-setup';

/** What `global-setup.ts` wrote, for a spec to read without re-deriving it via the UI. */
export function loadDemoContext(): DemoContext {
  const file = path.join(__dirname, '.demo-context.json');
  return JSON.parse(readFileSync(file, 'utf8')) as DemoContext;
}

/** A Platform address: nested under GOLD's own organization, which is the context the operator is working in. */
export function platformUrl(subpath = ''): string {
  return `/organizations/${loadDemoContext().goldOrganizationId}/platform${subpath ? `/${subpath}` : ''}`;
}

export const OWNER_STORAGE_STATE = path.join(__dirname, '.auth', 'owner.json');
export const STAFF_STORAGE_STATE = path.join(__dirname, '.auth', 'staff.json');
/** The demo's own reduced-role colleague (`business.member` in `scripts/demo/businesses.ts`) — signed in with no `role.manage` and no `customer.create`. */
export const COLLEAGUE_STORAGE_STATE = path.join(__dirname, '.auth', 'colleague.json');
