import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase F's boundaries, held by reading source. The database half is
 * `architecture/database/voice-boundary.test.ts`.
 *
 * A call is one business fact; the carrier's legs, identifiers and vocabulary stay behind the
 * telephony capability, and a business configures how it uses a number without ever reaching the
 * provisioning that produced it. Each of these is the thing a convenient change would break first.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const rel = (path: string) => relative(ROOT, path).replaceAll('\\', '/');
const sources = (directory: string, pattern = /\.(ts|tsx)$/) => walk(join(ROOT, directory)).filter((path) => pattern.test(path));
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The text of `export type <name> = { ... }`, so a test can read what a type exposes rather than what its file says. */
function typeBody(text: string, name: string): string {
  const start = text.indexOf(`export type ${name} = {`);
  if (start === -1) throw new Error(`no exported type ${name}`);
  const end = text.indexOf('\n};', start);
  return text.slice(start, end);
}

const DOMAIN = ['calls', 'conference', 'numbers'].map((name) => `lib/domain/reception/${name}.ts`);
const ROUTES = 'app/organizations/[organizationId]';
const VOICE_UI = [...sources('features/communications/voice'), ...sources('features/communications/numbers')];
const SETUP_DRAWER = [
  `${ROUTES}/calls/page.tsx`,
  `${ROUTES}/calls/actions.ts`,
  'features/communications/voice/outbound-identity.tsx',
  'features/communications/voice/voice-settings-sheet.tsx',
];
const CALLS_AND_NUMBERS_ROUTES = [...sources(`${ROUTES}/calls`), ...sources(`${ROUTES}/comms/numbers`)];

describe('the call domain speaks only the capability', () => {
  it('imports the telephony capability and never an implementation', () => {
    for (const file of DOMAIN) {
      const imports = [...source(file).matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      for (const path of imports) {
        expect(path, `${file} imports ${path}`).not.toMatch(/adapters\/telephony\/(twilio|registry)/);
        expect(path, `${file} imports ${path}`).not.toMatch(/twilio/i);
      }
    }
  });

  it('names no vendor outside a comment', () => {
    for (const file of DOMAIN) {
      expect(withoutComments(source(file)), file).not.toMatch(/twilio|twiml|CallSid|ConferenceSid|AccountSid/i);
    }
  });

  it('hands a screen no carrier identifier: a call and a participant carry none', () => {
    const calls = source('lib/domain/reception/calls.ts');
    const conference = source('lib/domain/reception/conference.ts');
    for (const body of [typeBody(calls, 'Call'), typeBody(calls, 'CallLeg'), typeBody(conference, 'Participant')]) {
      expect(body).not.toMatch(/externalId|external_id|providerId|sid\b/i);
    }
    // A participant says only whether the carrier has named it yet.
    expect(typeBody(conference, 'Participant')).toMatch(/connectable: boolean/);
  });

  it('never selects a carrier identifier from the calls table', () => {
    const selectLiteral = /const CALL_SELECT =\s*([\s\S]*?);\r?\n/.exec(source('lib/domain/reception/calls.ts'))?.[1] ?? '';
    expect(selectLiteral).toContain('customer_id');
    expect(selectLiteral).not.toMatch(/external_id|recording_url/);
  });

  it('resolves a caller through the database’s one customer rule, not a second one', () => {
    for (const file of DOMAIN) {
      expect(source(file), file).not.toMatch(/normalize_phone|contact_matches|\.ilike\(['"]phone|\.eq\(['"]phone['"]/);
    }
  });

  it('resolves the number to dial from in one database function and no screen re-derives it', () => {
    expect(source('lib/domain/reception/numbers.ts')).toMatch(/rpc\('resolve_outbound_number'/);
    for (const path of [...VOICE_UI, ...CALLS_AND_NUMBERS_ROUTES]) {
      // The set-up drawer edits the business's own default number; that is configuration, not choosing a sender.
      if (SETUP_DRAWER.includes(rel(path))) continue;
      expect(source(rel(path)), rel(path)).not.toMatch(/telephony_settings|calling_number|callingNumber|is_default/);
    }
  });
});

describe('the screens never reach the carrier', () => {
  it('imports the browser carrier’s SDK in exactly one file', () => {
    const importing = [...VOICE_UI, ...CALLS_AND_NUMBERS_ROUTES, ...sources('components'), ...sources('features/crm')]
      .filter((path) => /@twilio\//.test(readFileSync(path, 'utf8')))
      .map(rel);
    expect(importing).toEqual(['features/communications/voice/telephone-device.tsx']);
  });

  it('imports no adapter from a call or number screen', () => {
    for (const path of [...VOICE_UI, ...CALLS_AND_NUMBERS_ROUTES]) {
      expect(readFileSync(path, 'utf8'), rel(path)).not.toMatch(/lib\/adapters\//);
    }
  });

  it('shows no provider identifier on a call or number screen', () => {
    const IDENTIFIER = /externalId|external_id|providerResource|provider_resource|secret_id|subaccount|\bSID\b|twiml|account[_ ]?sid/i;
    for (const path of [...VOICE_UI, ...CALLS_AND_NUMBERS_ROUTES]) {
      if (rel(path).endsWith('telephone-device.tsx')) continue;
      expect(withoutComments(readFileSync(path, 'utf8')), rel(path)).not.toMatch(IDENTIFIER);
    }
  });

  it('reads calls only through the domain layer', () => {
    for (const path of [...sources('app'), ...sources('features'), ...sources('components')]) {
      expect(readFileSync(path, 'utf8'), rel(path)).not.toMatch(/\.from\(['"](calls|call_participants|call_events)['"]\)/);
    }
  });
});

describe('there is one place calls are listed', () => {
  it('draws every call list with CallHistory', () => {
    const tables = [...sources('app'), ...sources('features')].filter((path) => /key: 'caller'/.test(readFileSync(path, 'utf8')));
    expect(tables.map(rel)).toEqual(['features/communications/voice/call-history.tsx']);
  });

  it('keeps one calls route with one detail page, and no second voice history', () => {
    const routes = sources(`${ROUTES}/calls`, /page\.tsx$/).map((path) => rel(path).replace(`${ROUTES}/`, ''));
    expect(routes.sort()).toEqual(['calls/[callId]/page.tsx', 'calls/page.tsx']);
    // The old "every call" widget view was a second list.
    expect(source(`${ROUTES}/calls/page.tsx`)).not.toMatch(/widget=calls|widget === 'calls'/);
  });
});

describe('numbers are configured, never provisioned, from the screen', () => {
  it('does not write or read provisioning from the number domain', () => {
    expect(withoutComments(source('lib/domain/reception/numbers.ts'))).not.toMatch(
      /organization_provider_(bindings|resources)|sync_phone_number|record_provider_resource|begin_provider_binding|providers\//,
    );
  });

  it('offers no purchase or porting control', () => {
    for (const path of [...VOICE_UI, ...sources(`${ROUTES}/comms/numbers`)]) {
      expect(readFileSync(path, 'utf8'), rel(path)).not.toMatch(/buy a number|buy number|port (a )?number/i);
    }
  });

  it('writes a number only through the configuring, assigning and releasing doors', () => {
    const numbers = source('lib/domain/reception/numbers.ts');
    expect([...numbers.matchAll(/\.(insert|update|delete|upsert)\(/g)]).toEqual([]);
    const rpcs = [...numbers.matchAll(/rpc\('([a-z_]+)'/g)].map((match) => match[1]).sort();
    expect(rpcs).toEqual([
      'assign_phone_number',
      'configure_phone_number',
      'release_phone_number_assignment',
      'resolve_outbound_number',
      'set_user_phone_number_preference',
    ]);
  });
});
