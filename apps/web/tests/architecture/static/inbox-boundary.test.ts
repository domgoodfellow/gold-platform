import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Inbox unifies the operator's task, not the channels, and owns three facts about a conversation —
 * its state, who is handling it, and who it is about — without owning CRM. These are the rules that keep
 * that true as the Inbox grows: one canonical query and one canonical screen, one assignment mechanism
 * keyed by membership, no Customer model of its own, and old addresses that redirect instead of competing.
 */

const WEB = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = join(WEB, '..', '..');
const ROUTES = join(WEB, 'app', 'organizations', '[organizationId]');

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

describe('one canonical Inbox', () => {
  it('reads conversations through the one domain query, never by stitching two channels together', () => {
    const screens = [...under('features/communications/inbox'), ...under('app/organizations/[organizationId]/comms/inbox')];
    expect(screens.length).toBeGreaterThan(5);
    for (const [path, text] of screens) {
      expect(text, path).not.toMatch(/\.from\('(conversations|messages)'\)/);
      expect(text, path).not.toMatch(/listConversations\(/);
    }
    expect(code('app/organizations/[organizationId]/comms/inbox/actions.ts')).toMatch(/listInbox\(/);
  });

  it('filters in the database and pages by keyset, never by downloading everything', () => {
    const inbox = code('lib/domain/reception/inbox.ts');
    expect(inbox).toMatch(/\.limit\(limit \+ 1\)/);
    expect(inbox).toMatch(/last_message_at\.lt/);
    expect(inbox).not.toMatch(/\.filter\(\(item\)[^)]*status/);
  });

  it('has one conversation screen, at a channel-neutral address', () => {
    expect(existsSync(join(ROUTES, 'comms', 'inbox', '[conversationId]', 'page.tsx'))).toBe(true);
    for (const stale of ['sms', 'email', 'messages']) {
      expect(existsSync(join(ROUTES, 'comms', stale, '[conversationId]')), `comms/${stale}/[conversationId]`).toBe(false);
    }
  });

  it('leaves the old Text messages and Email addresses as redirects, not as second operating screens', () => {
    for (const legacy of ['messages', 'email']) {
      expect(existsSync(join(ROUTES, 'comms', legacy, 'page.tsx')), `comms/${legacy} must not be a page`).toBe(false);
    }
    const config = readFileSync(join(WEB, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/comms\/messages[^}]*comms\/inbox\?channel=sms/);
    expect(config).toMatch(/comms\/email[^}]*comms\/inbox\?channel=email/);
  });

  it('shows no provider anywhere in the Inbox', () => {
    for (const [path, text] of [...under('features/communications/inbox'), ...under('app/organizations/[organizationId]/comms/inbox'), ['lib/domain/reception/inbox.ts', code('lib/domain/reception/inbox.ts')] as [string, string]]) {
      expect(text, path).not.toMatch(/twilio|resend|stripe|external_id|provider_message|svix/i);
    }
  });
});

describe('assignment is one mechanism, keyed by membership', () => {
  it('lives in one column on the one conversation table, not once per channel', () => {
    const touching = migrations().filter(({ sql }) => /assignee_membership_id/.test(sql)).map(({ name }) => name);
    expect(touching).toEqual(['20261111000001_a_conversation_has_a_status_and_an_owner.sql']);

    const sql = migrations().find(({ name }) => name === touching[0])!.sql;
    expect(sql).toMatch(/alter table public\.conversations[\s\S]*add column assignee_membership_id/);
    expect(sql).toMatch(/references public\.memberships \(organization_id, id\)/);
    // Tenant-leading, and never a global user id.
    expect(sql).not.toMatch(/assignee_user_id|assigned_to_user/);
  });

  it('creates no assignment table of its own for either channel', () => {
    const offenders = migrations()
      .flatMap(({ name, sql }) => [...sql.matchAll(/create table public\.([a-z_]*(?:sms|email|message|conversation)[a-z_]*assign[a-z_]*)/gi)].map((m) => `${name}: ${m[1]}`));
    expect(offenders).toEqual([]);
  });

  it('is changed only through the doors, and the browser names no assignee relationship it is trusted on', () => {
    const sql = migrations().find(({ name }) => name === '20261111000001_a_conversation_has_a_status_and_an_owner.sql')!.sql;
    // No new column grant for the three facts a person changes.
    expect(sql).not.toMatch(/grant update \([^)]*(status|assignee_membership_id|customer_id)/);
    for (const door of ['claim_conversation', 'assign_conversation', 'release_conversation', 'set_conversation_status', 'link_conversation_customer']) {
      expect(sql, door).toMatch(new RegExp(`create function public\\.${door}\\(`));
    }
  });
});

describe('Communications links to CRM and never becomes it', () => {
  it('creates a contact only through CRM’s own function, and never writes the contacts table itself', () => {
    const inbox = code('lib/domain/reception/inbox.ts');
    expect(inbox).toMatch(/createContact\(/);
    expect(inbox).not.toMatch(/\.from\('(customers|contacts)'\)\s*\.(insert|update|delete|upsert)/);
    for (const [path, text] of under('features/communications/inbox')) {
      expect(text, path).not.toMatch(/\.from\('(customers|contacts)'\)/);
    }
  });

  it('adds no customer-like table or a duplicated customer detail onto a conversation', () => {
    const sql = migrations().filter(({ name }) => name >= '20261111').map(({ sql: text }) => text).join('\n');
    expect(sql).not.toMatch(/create table public\.(contacts|contact_points|communication_customers|conversation_customers)/i);
    expect(sql).not.toMatch(/alter table public\.conversations[\s\S]{0,200}add column (customer_name|customer_email|customer_phone)/i);
  });

  it('matches contact points inside one organization only, with one normalization each', () => {
    const sql = migrations().find(({ name }) => name === '20261111000001_a_conversation_has_a_status_and_an_owner.sql')!.sql;
    expect(sql).toMatch(/where c\.organization_id = p_organization_id/);
    expect(sql).toMatch(/create function app\.normalize_phone/);
    expect(sql).toMatch(/create function app\.normalize_email/);
    // Provider-specific email rules (a Gmail address's dots, a `+tag`) are not identity truth.
    const executable = sql.replace(/--.*$/gm, '');
    expect(executable).not.toMatch(/gmail/i);
    expect(executable).not.toMatch(/'[^']*\\+[^']*@[^']*'/);
  });
});
