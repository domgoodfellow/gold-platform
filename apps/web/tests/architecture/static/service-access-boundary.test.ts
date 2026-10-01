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
// The Platform subtree is not "inside a business": its actions are staff writes through narrow
// `security definer` doors that check `platform_staff` themselves (`app.require_platform_staff()`),
// and a business's service access is not a question they ask. Plan & Add-on administration moved
// to Finance's own route tree, but it is the same staff-checked write, gated by
// `requirePlatformArea` in its page rather than a business's service access — so it is excluded
// here the same way the Platform subtree is.
const RECOVERY_ACTIONS = ['app/organizations/[organizationId]/settings/plan/actions.ts'];
const actionFiles = [
  ...walk(ORGANIZATION, (name) => name === 'actions.ts')
    .map(rel)
    .filter((file) => !file.includes('/platform/') && !file.includes('/finance/plans/')),
  'features/agent/actions.ts',
  'features/work/configuration/actions.ts',
];

// The billing-recovery guard's complete list of users.
const RECOVERY_USERS = [
  'features/shell/organization-shell.tsx',
  'app/organizations/[organizationId]/settings/plan/page.tsx',
  'app/organizations/[organizationId]/settings/plan/actions.ts',
  'app/organizations/[organizationId]/settings/plan/locked/page.tsx',
  'lib/route/organization.ts',
  // The Platform console stays reachable while GOLD's own service access is locked, exactly as the
  // shell drawing it does; `requirePlatformScope` is where that is decided, once.
  'lib/route/platform.ts',
];

const GUARD = /\brequireOrganization(ForBillingRecovery)?\(/;

// `features/agent/actions.ts` hosts one platform-scoped action beside its organization ones:
// Platform Agent's own lazy bootstrap (Slice 12), which proves `requirePlatformScope` rather than
// a business's service access — the same exception the Platform console itself already has
// (`RECOVERY_USERS` above), because asking whether Platform Agent may answer is not a question
// about an organization's own subscription.
const PLATFORM_SCOPED_ACTIONS = ['loadPlatformAgentAvailabilityAction'];

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
        const name = chunk.split('(')[0];
        if (PLATFORM_SCOPED_ACTIONS.includes(name)) {
          expect(chunk).toMatch(/\brequirePlatformScope\(/);
          continue;
        }
        if (!GUARD.test(chunk)) unguarded.push(`${file}: ${name}`);
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
