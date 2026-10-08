import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREAS, areasIn, type Area } from '@/lib/navigation';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The Band 1 Communications foundation, held as rules rather than as a description of one change:
 * a conversation is not an SMS thread, a `From` is never a client's word, and calling and texting
 * are two authorities that navigation must not collapse into one.
 */

const WEB = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = join(WEB, '..', '..');

/** Source with comments removed, so prose explaining a rule never trips the rule. */
function code(relative: string): string {
  return readFileSync(join(WEB, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const area = (segment: string): Area => {
  const found = AREAS.find((candidate) => candidate.segment === segment);
  if (!found) throw new Error(`no area ${segment}`);
  return found;
};

describe('a conversation is channel-capable', () => {
  it('has a typed email conversation that carries no phone number', () => {
    const source = code('lib/domain/reception/messaging.ts');
    const email = source.match(/export type EmailConversation = ConversationBase & \{([\s\S]*?)\n\};/)?.[1] ?? '';
    expect(email).toContain("channel: 'email'");
    expect(email).toContain('emailIdentityId');
    expect(email).not.toMatch(/phoneNumberId|externalNumber/);
  });

  it('is no longer structurally dependent on a phone number in the schema', () => {
    const migrations = join(REPO, 'supabase', 'migrations');
    const channel = readdirSync(migrations)
      .map((name) => readFileSync(join(migrations, name), 'utf8'))
      .find((sql) => sql.includes('conversations_channel_addressing'));
    expect(channel).toBeDefined();
    expect(channel).toMatch(/alter column phone_number_id drop not null/);
    expect(channel).not.toMatch(/drop table|create table public\.conversations/i);
  });

  it('has no parallel email conversation table', () => {
    const migrations = join(REPO, 'supabase', 'migrations');
    const all = readdirSync(migrations).map((name) => readFileSync(join(migrations, name), 'utf8')).join('\n');
    expect(all).not.toMatch(/create table public\.email_conversations/i);
  });
});

describe('a sender address is never a client’s word', () => {
  it('has no fromNumber in the send contract, the action, or the screen', () => {
    expect(code('lib/domain/reception/messaging.ts')).not.toMatch(/fromNumber/);
    for (const [path, text] of [...codeUnder('app/organizations/[organizationId]/comms/inbox'), ...codeUnder('features/communications/inbox')]) {
      expect(text, path).not.toMatch(/fromNumber/);
    }
  });

  it('resolves the sender in the domain layer from an id', () => {
    const source = code('lib/domain/reception/messaging.ts');
    expect(source).toContain('resolveSmsSender');
    expect(source).toMatch(/from: sender\.e164/);
  });

  it('holds the same shape for email: an identity id in, an address out, and no from parameter', () => {
    const source = code('lib/domain/email/identities.ts');
    const signature = source.match(/export async function resolveEmailSender\(([\s\S]*?)\)\s*:/)?.[1] ?? '';
    expect(signature).toContain('emailIdentityId');
    expect(signature).not.toMatch(/\bfrom\b|fromEmail|address/);
  });
});

describe('calling and messaging are separate authorities in navigation', () => {
  const everything = new Set(AREAS.flatMap((a) => a.featureKeys ?? []));
  const modules = new Set(['reception']);
  const visible = (capabilities: Capability[]) =>
    areasIn('workspaces', modules, new Set(capabilities), everything)
      .filter((a) => a.workspace === 'communications')
      .map((a) => a.segment);

  it('does not gate the Inbox by call.place, nor Calls by message.send', () => {
    expect(area('comms-inbox').relevantCapabilities).not.toContain('call.place');
    expect(area('comms-inbox').relevantCapabilities).toEqual(['message.send']);
    expect(area('calls').relevantCapabilities).not.toContain('message.send');
  });

  it('does not require call.place for the Communications workspace as a whole', () => {
    expect(area('comms').relevantCapabilities).toContain('message.send');
    expect(area('comms-numbers').relevantCapabilities).toContain('message.send');
  });

  it('shows everything to a person who can both call and text', () => {
    expect(visible(['call.place', 'message.send'])).toEqual(['comms', 'calls', 'comms-inbox', 'comms-numbers']);
  });

  it('shows a texting-only person Communications and the Inbox, and no Calls', () => {
    expect(visible(['message.send'])).toEqual(['comms', 'comms-inbox', 'comms-numbers']);
  });

  it('shows a calling-only person Communications and Calls, and neither text nor email', () => {
    expect(visible(['call.place'])).toEqual(['comms', 'calls', 'comms-numbers']);
  });

  it('gates the Inbox by the sending authority, never by configuration', () => {
    expect(area('comms-inbox').relevantCapabilities).toEqual(['message.send']);
    expect(area('comms-inbox').relevantCapabilities).not.toContain('organization.manage');
  });

  it('shows a person with neither no Communications surface at all', () => {
    expect(visible([])).toEqual([]);
  });

  it('keeps Communications Home from asserting a calling warning to a person who cannot call', () => {
    const source = code('lib/application/communications/dashboard.ts');
    expect(source).toContain("capabilities.includes('call.place')");
    expect(source).toContain("capabilities.includes('message.send')");
    expect(source).toMatch(/mayCall \? getCallCounts/);
  });
});

/** Every .ts/.tsx file under a directory, comments stripped, as [relative path, code]. */
function codeUnder(relative: string): [string, string][] {
  const found: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(WEB, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.next') walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        found.push([path, code(path)]);
      }
    }
  };
  walk(relative);
  return found;
}

describe('email is a Communications channel, not a provider path', () => {
  it('hands the provider capability a message id and nothing a caller could redirect', () => {
    const contract = code('lib/adapters/tenant-email/index.ts');
    const submission = contract.match(/export type EmailSubmission = \{([^}]*)\}/)?.[1] ?? '';
    expect(submission).toContain('messageId');
    expect(submission).not.toMatch(/\b(from|to|subject|text|html|body|recipient|address)\b/i);
  });

  it('lets exactly one domain module reach the tenant email capability', () => {
    const importers = [...codeUnder('lib'), ...codeUnder('app'), ...codeUnder('features')]
      .filter(([path]) => !path.startsWith('lib/adapters/tenant-email/'))
      .filter(([, text]) => /adapters\/tenant-email/.test(text))
      .map(([path]) => path);
    expect(importers).toEqual(['lib/domain/email/messages.ts']);
  });

  it('keeps the Inbox screens and their actions free of any provider, and of any address field to send as', () => {
    const files = [...codeUnder('features/communications/inbox'), ...codeUnder('app/organizations/[organizationId]/comms/inbox')];
    expect(files.length).toBeGreaterThan(0);
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(/resend|@\/lib\/adapters\//i);
      expect(text, path).not.toMatch(/fromEmail|from_address|name="from"|name=.from./);
    }
  });

  it('does not provision a sending domain, or use the platform sender, from the send flow', () => {
    const messages = code('lib/domain/email/messages.ts');
    expect(messages).not.toMatch(/sending-domains|email-domains|requestSendingDomain|platformEmailSender|PlatformEmailSender/);
  });

  it('keeps CRM from sending email on its own', () => {
    for (const dir of ['lib/domain/customers', 'lib/domain/crm', 'features/customers']) {
      let files: [string, string][] = [];
      try {
        files = codeUnder(dir);
      } catch {
        continue; // a directory that does not exist sends nothing
      }
      for (const [path, text] of files) expect(text, path).not.toMatch(/adapters\/tenant-email|email\/messages|sendEmail/);
    }
  });

  it('never lets the web runtime write what only the provider may say about a message', () => {
    const doors = /record_email_send_result|claim_email_for_send|record_email_event|record_inbound_email|record_inbound_attachment_stored/;
    const offenders = [...codeUnder('lib'), ...codeUnder('app'), ...codeUnder('features')]
      .filter(([path]) => path !== 'lib/db/database.types.ts')
      .filter(([, text]) => doors.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('puts only sanitized HTML on the type a screen receives', () => {
    const messages = readFileSync(join(WEB, 'lib/domain/email/messages.ts'), 'utf8');
    const thread = messages.match(/export type EmailThreadMessage = \{([\s\S]*?)\n\};/)?.[1] ?? '';
    expect(thread).toContain('safeHtml');
    expect(thread).not.toMatch(/^\s*html\b/m);
    expect(messages).toContain('sanitizeEmailHtml(');
  });

  it('serves an attachment only as an opaque download', () => {
    const route = code('app/organizations/[organizationId]/comms/attachments/[attachmentId]/route.ts');
    expect(route).toContain("'content-type': 'application/octet-stream'");
    expect(route).toMatch(/attachment; filename/);
    expect(route).toContain('nosniff');
  });

  it('has the outbound commands the pipeline names, and one channel-neutral reply', () => {
    const outbound = code('lib/domain/reception/outbound.ts');
    expect(outbound).toMatch(/export \{ sendSms \}/);
    expect(outbound).toMatch(/sendEmail/);
    expect(outbound).toMatch(/export async function replyToConversation/);
  });
});
