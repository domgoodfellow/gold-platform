import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Python deployable handlers, held to one another so their count cannot drift again.
 *
 * Four things describe the same set and had come to disagree: the files in `apps/api/api/`, the
 * rewrites in `apps/api/vercel.json`, the route table in `apps/api/README.md`, and the handler wiring
 * test. Two handlers had no rewrite (so their documented route did not exist), the README listed seven
 * of thirteen, and one handler had no wiring test. The table below is the single explicit inventory;
 * each of the four is checked against it, so adding, removing or forgetting a handler fails here.
 *
 * Every handler here takes input from outside a trust boundary, so every one must be driven by
 * `tests/component/test_handlers.py`. `trust` says how the handler decides to believe its caller, and
 * the marker is what has to still appear in its source: a handler that stops calling its check
 * stops matching its row.
 */

const API = fileURLToPath(new URL('../../../../api', import.meta.url));
const read = (path: string) => readFileSync(join(API, path), 'utf8');

const TRUST = {
  'stripe-signature': /stripe-signature/i,
  'twilio-signature': /verify_signature\(/,
  'cron-secret': /cron_secret/,
  'bearer-token': /require_caller\(/,
  'shared-key': /x-gold-public-chat-key/,
} as const;

const INVENTORY: { file: string; route: string; trust: keyof typeof TRUST }[] = [
  { file: 'stripe_webhook', route: '/webhooks/stripe', trust: 'stripe-signature' },
  { file: 'stripe_platform_billing_webhook', route: '/webhooks/stripe-platform-billing', trust: 'stripe-signature' },
  { file: 'automation_tick', route: '/tasks/automation-tick', trust: 'cron-secret' },
  { file: 'ai_ask', route: '/ai/ask', trust: 'bearer-token' },
  { file: 'crm_change_customer_stage', route: '/crm/change-customer-stage', trust: 'bearer-token' },
  { file: 'voice_wrap_up_call', route: '/voice/wrap-up-call', trust: 'bearer-token' },
  { file: 'routing_preview_inbound', route: '/routing/preview-inbound', trust: 'bearer-token' },
  { file: 'routing_preview_outbound', route: '/routing/preview-outbound', trust: 'bearer-token' },
  { file: 'integration_operations', route: '/integrations/operate', trust: 'bearer-token' },
  { file: 'provider_operations', route: '/providers/operate', trust: 'bearer-token' },
  { file: 'organization_domains', route: '/organizations/domains', trust: 'bearer-token' },
  { file: 'voice_inbound', route: '/voice/inbound', trust: 'twilio-signature' },
  { file: 'voice_outbound', route: '/voice/outbound', trust: 'twilio-signature' },
  { file: 'voice_status', route: '/voice/status', trust: 'twilio-signature' },
  { file: 'voice_recording', route: '/voice/recording', trust: 'twilio-signature' },
  { file: 'sms_inbound', route: '/sms/inbound', trust: 'twilio-signature' },
  { file: 'sms_status', route: '/sms/status', trust: 'twilio-signature' },
  { file: 'public_chat', route: '/public_chat', trust: 'shared-key' },
  { file: 'invitation_email', route: '/invitations/email', trust: 'bearer-token' },
  { file: 'invitation_email_webhook', route: '/webhooks/invitation-email', trust: 'twilio-signature' },
];

const files = readdirSync(join(API, 'api')).filter((name) => name.endsWith('.py'));
const handlers = files.filter((name) => /^class handler\b/m.test(read(`api/${name}`))).map((name) => name.replace(/\.py$/, ''));
const byFile = new Map(INVENTORY.map((entry) => [entry.file, entry]));

describe('the deployable handlers in apps/api/api', () => {
  it('are exactly the inventory, so a new one must be declared and an old one removed from it', () => {
    expect([...handlers].sort()).toEqual(INVENTORY.map((entry) => entry.file).sort());
  });

  it('leave nothing else in the directory but the package file', () => {
    expect(files.filter((name) => name !== '__init__.py' && !handlers.includes(name.replace(/\.py$/, '')))).toEqual([]);
  });

  it('each still calls the check its row says it trusts its caller by', () => {
    for (const entry of INVENTORY) {
      expect(TRUST[entry.trust].test(read(`api/${entry.file}.py`)), `${entry.file} no longer shows its ${entry.trust} check`).toBe(true);
    }
  });
});

describe('vercel.json', () => {
  const config = JSON.parse(read('vercel.json')) as {
    rewrites: { source: string; destination: string }[];
    crons?: { path: string }[];
  };

  it('routes every handler at its documented route, and routes nothing else', () => {
    const declared = config.rewrites.map((rewrite) => `${rewrite.source} -> ${rewrite.destination}`).sort();

    expect(declared).toEqual(INVENTORY.map((entry) => `${entry.route} -> /api/${entry.file}`).sort());
  });

  it('schedules only a route that exists', () => {
    const routes = new Set(INVENTORY.map((entry) => entry.route));

    for (const cron of config.crons ?? []) expect(routes.has(cron.path), cron.path).toBe(true);
  });
});

describe('the README route table', () => {
  const rows = [...read('README.md').matchAll(/^\|\s*`(?:GET|POST)(?:, (?:GET|POST))* (\/[^`]+)`\s*\|\s*`api\/([a-z_]+)\.py`/gm)].map((match) => ({
    route: match[1],
    file: match[2],
  }));

  it('lists every handler at its route, and no handler that is gone', () => {
    expect(rows.map((row) => `${row.route} ${row.file}`).sort()).toEqual(INVENTORY.map((entry) => `${entry.route} ${entry.file}`).sort());
  });

  it('states the count it has', () => {
    expect(read('README.md')).toContain(`${INVENTORY.length} deployable handlers`);
  });
});

describe('the handler wiring test', () => {
  const wiring = read('tests/component/test_handlers.py');
  const imported = [...wiring.matchAll(/^import api\.([a-z_]+) as /gm)].map((match) => match[1]);

  it('drives every handler, because every one takes input from outside a trust boundary', () => {
    expect(INVENTORY.map((entry) => entry.file).filter((file) => !imported.includes(file))).toEqual([]);
  });

  it('drives no handler that no longer exists', () => {
    expect(imported.filter((file) => !byFile.has(file))).toEqual([]);
  });
});
