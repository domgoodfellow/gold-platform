import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_TARGETS } from '@/lib/navigation';

/**
 * Two boundaries that keep a credential and a vendor where they belong.
 *
 * **A vendor stays behind the capability.** Studio asks for a *repository*; which vendor holds it,
 * and how that vendor's rows read, is `lib/adapters/source-control` alone. Studio and the public
 * site never name one, so a second source-control vendor arrives without touching them.
 *
 * **A credential has one reader, and it is not here.** Everything a business gave GildOps — a
 * delegated sign-in, a private value — is read only by a machine role in `apps/api`. Nothing a
 * browser can reach, and nothing a person's own session runs, names the doors that decrypt.
 */

const ROOT = join(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next') return [];
    return statSync(join(ROOT, path)).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('a vendor stays behind the source-control capability', () => {
  const NAMES_THE_VENDOR = /github/i;

  it('finds the places it scans, so the rule is not passing over an empty tree', () => {
    expect(sources('features/studio').length).toBeGreaterThan(0);
    expect(sources('lib/domain/public-site').length).toBeGreaterThan(0);
    expect(sources('lib/domain/source-control').length).toBeGreaterThan(0);
  });

  it('keeps Studio, the public site and the capability itself free of any vendor name', () => {
    const offenders = [
      ...sources('features/studio'),
      ...sources('features/public-site'),
      ...sources('lib/domain/public-site'),
      ...sources('lib/domain/source-control'),
    ].filter((file) => NAMES_THE_VENDOR.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('lets only the registry import a vendor’s implementation, and nothing above it import one', () => {
    const importers = sources('lib').concat(sources('features'), sources('app')).filter((file) => /from '\.\/github'|adapters\/source-control\/github/.test(read(file)));
    expect(importers.map((file) => file.replaceAll('\\', '/'))).toEqual(['lib/adapters/source-control/registry.ts']);
  });

  it('has the domain depend on the capability’s own index and on no registry or implementation', () => {
    const imports = read('lib/domain/source-control/repositories.ts').match(/from '@\/lib\/adapters[^']*'/g) ?? [];
    expect(imports).toEqual(["from '@/lib/adapters/source-control'"]);
  });

  it('never writes: the capability reads a business’s authorization and asserts none', () => {
    const domain = read('lib/domain/source-control/repositories.ts');
    expect(domain).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(/);
  });
});

describe('no credential reader is reachable from a browser or a person’s own session', () => {
  const READERS = /read_integration_credential|read_provider_account_credential|resolve_secret_reference|decrypted_secrets|vault\.(secrets|decrypted)/;
  const APP_SECRETS = /GITHUB_APP_PRIVATE_KEY|GITHUB_APP_CLIENT_SECRET|GITHUB_APP_ID/;

  it('names no Vault reader anywhere in apps/web outside the generated database types', () => {
    const offenders = [...sources('lib'), ...sources('app'), ...sources('features'), ...sources('components')]
      .filter((file) => !file.replaceAll('\\', '/').endsWith('lib/db/database.types.ts'))
      .filter((file) => READERS.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('holds no GitHub App key, client secret or id in the web runtime', () => {
    const offenders = [...sources('lib'), ...sources('app'), ...sources('features')].filter((file) => APP_SECRETS.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('gives a stored private value no way out: the actions return a message, a saved flag and the non-secret draft', () => {
    const actions = read('app/organizations/[organizationId]/settings/secrets/actions.ts');
    expect(actions).toMatch(/export type SecretFormState = \{\s*error: string \| null;\s*saved\?: boolean;\s*draft\?: \{ key: string; label: string; purpose: string \};\s*\};/);
    expect(actions).not.toMatch(/redirect\(|NextResponse|cookies\(|console\./);
    const domain = read('lib/domain/secrets/secret-references.ts');
    expect(domain).not.toMatch(/\.select\([^)]*secret_id|\bsecret_id\b/);
  });
});

describe('Settings owns the canonical route for each place a credential is configured', () => {
  it('puts Secrets & credentials on its own permission and route, apart from Connections', () => {
    const secrets = CONFIG_TARGETS.find((target) => target.key === 'secrets');
    const connections = CONFIG_TARGETS.find((target) => target.key === 'integrations');
    expect(secrets).toMatchObject({ path: 'settings/secrets', permission: ['secret.manage'] });
    expect(connections?.permission).toEqual(['integration.manage']);
    expect(existsSync(join(ROOT, 'app/organizations/[organizationId]', secrets!.path, 'page.tsx'))).toBe(true);
  });
});
