import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `apps/web`'s normal database path must never hold a privileged Supabase credential.
 *
 * A source scan rather than a runtime assertion, for the same reason `layout.test.ts` and
 * `public-profile.test.ts` are: the property this protects is an *absence*, and the only
 * reliable way to prove an absence in a codebase this size is to read every file rather than
 * trust that nobody will add one. `lib/db/` is the one place a Supabase client is constructed
 * for a web request (`server.ts`'s own docstring says so) — this is where a service-role key,
 * a secret key, or a JWT signing secret would land if somebody reached for "just make it work".
 */

const LIB_DB = fileURLToPath(new URL('../lib/db', import.meta.url));

const FORBIDDEN = [
  /service_role/i,
  /SUPABASE_SECRET_KEY/,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /SUPABASE_JWT_SECRET/,
] as const;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('the request-scoped database client', () => {
  it('holds no privileged Supabase credential anywhere under lib/db', () => {
    for (const path of tsFiles(LIB_DB)) {
      const source = readFileSync(path, 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(source, `${path} must not reference ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('constructs its client from the publishable key, never a secret one', () => {
    const source = readFileSync(`${LIB_DB}/server.ts`, 'utf8');
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });
});
