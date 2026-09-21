import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Commercial service access is enforced where a request is decided — every page and every
 * server action inside a business — never by what the sidebar shows. A page is already held to
 * `requireOrganization` by `organization-page-guard.test.ts`; that guard now includes the
 * service question. What nothing held until now was the *actions*: they take an organization id
 * from a form field and used to rely on RLS alone, which knows nothing about a subscription.
 *
 * And the way round: `requireOrganizationForBillingRecovery` is the one door past the service
 * question, so its users are a closed list, not a convenience any page may reach for.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ORGANIZATION = join(WEB, 'app/organizations/[organizationId]');
const rel = (path: string) => relative(WEB, path).split(sep).join('/');

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, match);
    return match(entry.name) ? [full] : [];
  });
}

// Actions reachable from inside a business. `settings/plan/actions.ts` is the recovery surface.
const RECOVERY_ACTIONS = ['app/organizations/[organizationId]/settings/plan/actions.ts'];
const actionFiles = [
  ...walk(ORGANIZATION, (name) => name === 'actions.ts').map(rel),
  'features/agent/actions.ts',
  'features/work/configuration/actions.ts',
];

// The billing-recovery guard's complete list of users.
const RECOVERY_USERS = [
  'app/organizations/[organizationId]/layout.tsx',
  'app/organizations/[organizationId]/settings/plan/page.tsx',
  'app/organizations/[organizationId]/settings/plan/actions.ts',
  'app/organizations/[organizationId]/settings/plan/locked/page.tsx',
  'lib/route/organization.ts',
];

const GUARD = /\brequireOrganization(ForBillingRecovery)?\(/;

describe('service access is enforced by every server action inside a business', () => {
  it('finds the action files, so the rule is not passing over an empty tree', () => {
    expect(actionFiles.length).toBeGreaterThan(20);
  });

  it('calls a guard in every exported action before anything else can decide', () => {
    const unguarded: string[] = [];
    for (const file of actionFiles) {
      const source = readFileSync(join(WEB, file), 'utf8');
      // Everything after the first `export async function` splits into one chunk per action.
      const chunks = source.split(/^export async function /m).slice(1);
      for (const chunk of chunks) {
        if (!GUARD.test(chunk)) unguarded.push(`${file}: ${chunk.split('(')[0]}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('calls a guard in every route handler inside a business', () => {
    const handlers = walk(ORGANIZATION, (name) => name === 'route.ts').map(rel);
    expect(handlers.length).toBeGreaterThan(3);
    const unguarded = handlers.filter((file) => !GUARD.test(readFileSync(join(WEB, file), 'utf8')));
    expect(unguarded).toEqual([]);
  });

  it('lets only the recovery actions use the recovery guard', () => {
    const wrong = actionFiles.filter((file) => {
      const source = readFileSync(join(WEB, file), 'utf8');
      return source.includes('requireOrganizationForBillingRecovery') && !RECOVERY_ACTIONS.includes(file);
    });
    expect(wrong).toEqual([]);
  });
});

describe('the billing-recovery guard has a closed list of users', () => {
  it('appears nowhere else in app/, features/ or lib/', () => {
    const files = ['app', 'features', 'lib']
      .flatMap((dir) => walk(join(WEB, dir), (name) => /\.tsx?$/.test(name)))
      .map(rel)
      .filter((file) => readFileSync(join(WEB, file), 'utf8').includes('requireOrganizationForBillingRecovery'));
    expect(files.sort()).toEqual([...RECOVERY_USERS].sort());
  });

  it('is not used by any operational page', () => {
    const operational = walk(ORGANIZATION, (name) => name === 'page.tsx')
      .map(rel)
      .filter((file) => !RECOVERY_USERS.includes(file))
      .filter((file) => readFileSync(join(WEB, file), 'utf8').includes('requireOrganizationForBillingRecovery'));
    expect(operational).toEqual([]);
  });
});
