import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREAS } from '@/lib/navigation';

/**
 * SMS is a channel of Communications, not a subsystem beside it: the same Conversation, Message, Inbox,
 * customer rule, assignment and status as email, with only its addressing and its carrier its own — and
 * the carrier stays behind the adapter. These hold that as the code around it changes.
 */

const WEB = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = join(WEB, '..', '..');
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const code = (relative: string) => strip(readFileSync(join(WEB, relative), 'utf8'));

function under(relative: string): [string, string][] {
  const found: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(WEB, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) found.push([path, code(path)]);
    }
  };
  walk(relative);
  return found;
}

const migrations = () => {
  const dir = join(REPO, 'supabase', 'migrations');
  return readdirSync(dir).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
};

describe('SMS is a channel of canonical Communications', () => {
  it('has no table of its own for conversations, messages, assignment, status or customers', () => {
    const offenders = migrations().flatMap(({ name, sql }) =>
      [...sql.matchAll(/create table public\.(sms_[a-z_]+|[a-z_]*_sms[a-z_]*)/gi)].map((m) => `${name}: ${m[1]}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no second SMS operating screen: no Text messages page, and the Inbox is the only list', () => {
    expect(AREAS.map((area) => area.label)).not.toContain('Text messages');
    expect(AREAS.filter((area) => area.workspace === 'communications').map((area) => area.segment)).toEqual(['comms', 'calls', 'comms-inbox', 'comms-numbers']);
  });

  it('opens a text in the one channel-neutral conversation screen', () => {
    const detail = code('lib/domain/reception/inbox.ts');
    expect(detail).toMatch(/conversation\.channel === 'sms'/);
    expect(detail).toMatch(/listMessages\(/);
    expect(code('lib/domain/reception/outbound.ts')).toMatch(/conversation\.channel === 'sms'[\s\S]*sendSms\(/);
  });

  it('writes no text status from the web runtime: a send reports through its one door and nothing else', () => {
    const messaging = code('lib/domain/reception/messaging.ts');
    expect(messaging).toContain("rpc('record_sms_send_result'");
    expect(messaging).not.toMatch(/from\('messages'\)\s*\.update\(/);
    // Reading a text's state is fine; creating one with a carrier-owned column filled in is not.
    expect(messaging).not.toMatch(/from\('messages'\)\s*\.insert\(\{[^}]*(external_id|delivered_at|sent_at|failure_reason)/);
  });

  it('keeps the carrier’s vocabulary out of the Inbox, the commands and CRM', () => {
    const files = [
      ...under('features/communications/inbox'),
      ...under('app/organizations/[organizationId]/comms'),
      ...under('lib/domain/email'),
      ...under('lib/domain/customers'),
      ['lib/domain/reception/messaging.ts', code('lib/domain/reception/messaging.ts')] as [string, string],
      ['lib/domain/reception/outbound.ts', code('lib/domain/reception/outbound.ts')] as [string, string],
      ['lib/domain/reception/inbox.ts', code('lib/domain/reception/inbox.ts')] as [string, string],
    ];
    expect(files.length).toBeGreaterThan(15);
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(/twilio|Messages\.json|Accounts\/|TWILIO_(ACCOUNT_SID|AUTH_TOKEN)|StatusCallback|MessageSid/i);
    }
  });

  it('translates the carrier’s status words in the provider module, not in the callback handler', () => {
    const handler = readFileSync(join(REPO, 'apps', 'api', 'api', 'sms_status.py'), 'utf8');
    expect(handler).toMatch(/normalize_status\(/);
    expect(handler).not.toMatch(/"(accepted|scheduled|canceled|receiving)"/);
    const provider = readFileSync(join(REPO, 'apps', 'api', 'app', 'providers', 'twilio', 'sms.py'), 'utf8');
    expect(provider).toMatch(/_STATUS = \{/);
  });
});

describe('the carrier decides a text’s state', () => {
  const sql = () => migrations().find(({ name }) => name === '20261114000001_a_texts_state_is_the_carriers_word.sql')!.sql;

  it('lets a signed-in role create a text only as queued and grants it no update at all', () => {
    expect(sql()).toMatch(/and status = 'queued'/);
    expect(sql()).toMatch(/revoke update on public\.messages from authenticated/);
    expect(sql()).not.toMatch(/grant update[^;]*public\.messages[^;]*to authenticated/);
  });

  it('moves a status forward only, from one function that every writer of a text’s status calls', () => {
    const text = sql();
    expect(text).toMatch(/create function app\.advance_sms_status/);
    expect(text).toMatch(/app\.message_status_rank\(p_new\) <= app\.message_status_rank\(v_current\)/);
    expect(text.match(/app\.advance_sms_status\(/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves a business from a number only when exactly one active number holds it', () => {
    expect(sql()).toMatch(/having count\(\*\) = 1/);
    expect(sql()).toMatch(/lifecycle = 'active'/);
  });
});
