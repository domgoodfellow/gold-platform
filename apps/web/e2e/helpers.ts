import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DemoContext } from './global-setup';

/** What `global-setup.ts` wrote, for a spec to read without re-deriving it via the UI. */
export function loadDemoContext(): DemoContext {
  const file = path.join(__dirname, '.demo-context.json');
  return JSON.parse(readFileSync(file, 'utf8')) as DemoContext;
}

export const OWNER_STORAGE_STATE = path.join(__dirname, '.auth', 'owner.json');
export const STAFF_STORAGE_STATE = path.join(__dirname, '.auth', 'staff.json');
