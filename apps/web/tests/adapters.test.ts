import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';


/**
 * I15: no domain code imports a vendor SDK directly.
 *
 * **The invariant is structural, so the test reads the tree rather than exercising a path.**
 * The same reasoning `schema-conformance.test.ts` uses: a boundary that is only a convention
 * holds until somebody is in a hurry, and the failure is invisible at the moment it is
 * introduced — a domain file importing `./stripe` works perfectly, and costs nothing until the
 * day a second processor arrives and every call site has to be found.
 *
 * `constraints.md` states it as *domain code names capabilities — place a call, charge a card
 * — never providers*. So there are two assertions, and the second is the one with teeth: the
 * import boundary, and the absence of the word.
 */

// `apps/web` itself, since there is no `src/` for it to nest inside — see CLAUDE.md's layout.
const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** The providers this repository knows about. Grows with each adapter, never with a caller. */
const VENDORS = [
  'stripe',
  'twilio',
  'elevenlabs',
  'openai',
  'anthropic',
  // Geocoding. Named here the day the adapter landed, so the second capability is held to the
  // same line as the first rather than being trusted because it is small.
  'nominatim',
  'openstreetmap',
];

/**
 * Every capability contract. Each must be free of every provider's vocabulary.
 *
 * `drafting` is the one whose provider was named in `VENDORS` before the adapter existed, which
 * is the only reason this list and that one are worth keeping apart: the vendor list is what
 * this repository refuses to say in the wrong place, and it is allowed to run ahead of what has
 * been built.
 */
const CONTRACTS = ['payments', 'geocoding', 'drafting'];

describe('the adapter boundary (I15)', () => {
  it('has no domain file importing a provider implementation', () => {
    const offenders = sources(join(SRC, 'lib', 'domain')).filter((path) => {
      const text = readFileSync(path, 'utf8');
      // The capability interface is `@/lib/adapters/<capability>` exactly. Anything deeper is
      // an implementation, and reaching it is the thing this forbids.
      return /from\s+'@\/lib\/adapters\/[^']+\/[^']+'/.test(text);
    });

    expect(offenders).toEqual([]);
  });

  it('has no domain file naming a provider at all', () => {
    // The stronger half. An import is one way a provider leaks into the domain layer; a string
    // comparison is another, and it is the one that actually happened while this slice was
    // being written — `settleProviderPayment` derived a provider name from the shape of a
    // reference, which is domain code knowing what a Stripe id looks like. The provider now
    // travels on `ProviderPayment`, filled in by the adapter.
    const offenders = sources(join(SRC, 'lib', 'domain'))
      .map((path) => ({ path, text: readFileSync(path, 'utf8').toLowerCase() }))
      // The prose in `card-payments.ts` explains the boundary and would otherwise trip its own
      // test, so comments are stripped before looking.
      .map((file) => ({
        path: file.path,
        code: file.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
      }))
      .filter((file) => VENDORS.some((vendor) => file.code.includes(vendor)));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('keeps every capability interface free of the provider’s vocabulary', () => {
    // No `sessionId`, no `paymentIntent`, no `stripe`, no `placeId`. A domain function holding
    // a `sessionId` already knows who its provider is, whatever the type is called.
    for (const capability of CONTRACTS) {
      const contract = readFileSync(join(SRC, 'lib', 'adapters', capability, 'index.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .toLowerCase();

      for (const vendor of VENDORS) {
        expect(contract, `${capability} names ${vendor}`).not.toContain(vendor);
      }
      expect(contract).not.toContain('sessionid');
      expect(contract).not.toContain('placeid');
    }
  });
});

/**
 * The writer with no human caller.
 *
 * **The handler itself is Python and lives in `apps/api`** (D2, D26), with its own tests under
 * `apps/api/tests` — including the signature check and the shape of the token it mints. What
 * belongs here is the half that is a fact about *this database*: that the role it arrives as
 * can do almost nothing, which is the claim D14 makes concrete when it refuses service-role.
 */
describe('the writer with no human caller', () => {
  it('holds no grant on any table, and exactly one execute', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      // The claim D14 makes concrete. If this role could `select` one row of one table, the
      // argument for it over service-role would be a matter of degree.
      const { rows: tables } = await client.query(
        `select table_name, privilege_type
           from information_schema.role_table_grants
          where grantee = 'payment_webhook'`,
      );
      expect(tables).toEqual([]);

      const { rows: functions } = await client.query(
        `select p.proname
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('payment_webhook', p.oid, 'execute')
            and p.proname not in (
              select proname from pg_proc pp
               join pg_namespace nn on nn.oid = pp.pronamespace
              where nn.nspname = 'public' and has_function_privilege('public', pp.oid, 'execute')
            )`,
      );
      expect(functions.map((row) => row.proname)).toEqual(['record_provider_payment']);
    } finally {
      await client.end();
    }
  });

  it('has an integration actor that cannot sign in', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      // A real row, so `events.actor_id` is satisfiable — with nothing GoTrue could
      // authenticate against. The only way to act as it is to hold the JWT secret.
      const { rows } = await client.query(
        `select encrypted_password, email
           from auth.users
          where id = '00000000-0000-4000-8000-0000000000a1'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].encrypted_password).toBeNull();
      expect(rows[0].email).toBeNull();
    } finally {
      await client.end();
    }
  });
});
