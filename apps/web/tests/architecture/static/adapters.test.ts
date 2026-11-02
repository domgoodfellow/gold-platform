import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';


/**
 * The no-vendor-SDK-in-domain rule: no domain code imports a vendor SDK directly.
 *
 * **The invariant is structural, so the test reads the tree rather than exercising a path.**
 * The same reasoning `schema-conformance.test.ts` uses: a boundary that is only a convention
 * holds until somebody is in a hurry, and the failure is invisible at the moment it is
 * introduced — a domain file importing `./stripe` works perfectly, and costs nothing until the
 * day a second processor arrives and every call site has to be found.
 *
 * ADR-015 states it as *domain code names capabilities — place a call, charge a card
 * — never providers*. So there are two assertions, and the second is the one with teeth: the
 * import boundary, and the absence of the word.
 */

// `apps/web` itself, since there is no `src/` for it to nest inside — see CLAUDE.md's layout.
const SRC = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

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
  // GOLD's own transactional email (invitations) — a fourth capability, held to the same line.
  'resend',
  // Other mail carriers the tenant email capability must never be written in terms of.
  'postmark',
  'sendgrid',
  'mailgun',
  // Routing. Named the day the capability landed, for the same reason geocoding's were.
  'osrm',
  'mapbox',
  'graphhopper',
  // Document rendering. Named the day the capability landed, so the domain never says which library draws a PDF.
  'react-pdf',
  'pdfkit',
];

/**
 * Every capability contract. Each must be free of every provider's vocabulary.
 *
 * `drafting` is the one whose provider was named in `VENDORS` before the adapter existed, which
 * is the only reason this list and that one are worth keeping apart: the vendor list is what
 * this repository refuses to say in the wrong place, and it is allowed to run ahead of what has
 * been built.
 */
const CONTRACTS = ['payments', 'platform-billing', 'geocoding', 'routing', 'drafting', 'answering', 'telephony', 'messaging', 'email', 'email-domains', 'tenant-email', 'documents'];

describe('the adapter boundary', () => {
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
        // Auth's resend verb is an SDK method, not a delivery vendor reference.
        code: file.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\.auth\.resend\b/g, ''),
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

  it('keeps a tenant’s email to its customers a different capability from GildOps’ own platform email', () => {
    // Three email contracts, three questions: GildOps sending an invitation (`email`), proving a
    // business may send from a name (`email-domains`), and an organization writing to a person
    // (`tenant-email`). A tenant's mail must never be reachable through the platform's sender.
    const read = (capability: string) =>
      readFileSync(join(SRC, 'lib', 'adapters', capability, 'index.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const platform = read('email');
    const tenant = read('tenant-email');

    expect(platform).toContain('PlatformEmailSender');
    expect(platform).not.toContain('EmailProvider');
    expect(tenant).toContain('EmailProvider');
    expect(tenant).not.toContain('PlatformEmailSender');
    expect(tenant).not.toContain('sendInvitationEmail');
    // The tenant contract names a message and nothing a caller could redirect.
    expect(tenant).not.toMatch(/\b(from|to|subject)\s*:/);
  });

  it('lets nothing outside the tenant email capability reach an implementation behind its registry', () => {
    const importers = [...sources(join(SRC, 'lib')), ...sources(join(SRC, 'app')), ...sources(join(SRC, 'features'))]
      .filter((path) => !path.includes(join('lib', 'adapters', 'tenant-email')))
      .filter((path) => /from\s+'@\/lib\/adapters\/tenant-email\/[^']+'/.test(readFileSync(path, 'utf8')));
    expect(importers).toEqual([]);
  });
});
