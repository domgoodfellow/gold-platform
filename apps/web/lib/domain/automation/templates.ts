import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business says to its customers, and what it has said.
 *
 * **Not one word here belongs to the platform.** `constraints.md` forbids hardcoding a claim a
 * business makes about itself; a message arriving in somebody's inbox with that business's name
 * on it is the strongest form of such a claim, stronger than a public page, because nobody chose
 * to open it. So a template is a row a business wrote, the resolver substitutes values and adds
 * nothing, and there is no preamble, signature or footer anywhere in this platform.
 *
 * The placeholders below are the platform's contribution and they are the whole of it: five
 * names for things a business already has. Anything else a business types is left exactly as
 * typed rather than blanked, because deleting somebody's sentence is worse than leaving a word
 * they will recognise as their own mistake.
 */

export const PLACEHOLDERS = [
  { token: '{{job}}', label: 'the job’s title' },
  { token: '{{business}}', label: 'this business’s name' },
  { token: '{{customer}}', label: 'the customer’s name' },
  { token: '{{status}}', label: 'the status the job is in' },
  { token: '{{when}}', label: 'when it is scheduled, in this business’s timezone' },
] as const;

export const CHANNELS = [
  { channel: 'email', label: 'by email' },
  { channel: 'sms', label: 'by text message' },
] as const;

export type Channel = (typeof CHANNELS)[number]['channel'];

export type MessageTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export type MessageDelivery = {
  id: string;
  ruleName: string;
  channel: Channel;
  recipient: string;
  subjectLine: string;
  body: string;
  state: 'queued' | 'sent' | 'failed';
  detail: string | null;
  queuedAt: string;
  sentAt: string | null;
};

const NAME_MAX = 120;
const SUBJECT_MAX = 300;
const BODY_MAX = 4000;

export async function listMessageTemplates(
  db: Db,
  input: { organizationId: string },
): Promise<MessageTemplate[]> {
  const { data, error } = await db
    .from('message_templates')
    .select('id, name, subject, body')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'messages.templates_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    subject: row.subject,
    body: row.body,
  }));
}

function checkText(input: { name: string; subject: string; body: string }): void {
  if (input.name.trim().length === 0) {
    throw new DomainError('A template needs a name.', 'messages.name_required');
  }
  if (input.name.trim().length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'messages.name_too_long',
    );
  }
  if (input.subject.length > SUBJECT_MAX) {
    throw new DomainError(
      `That subject line is longer than ${SUBJECT_MAX} characters.`,
      'messages.subject_too_long',
    );
  }
  if (input.body.trim().length === 0) {
    throw new DomainError('A template needs something to say.', 'messages.body_required');
  }
  if (input.body.trim().length > BODY_MAX) {
    throw new DomainError(
      `That message is longer than ${BODY_MAX} characters.`,
      'messages.body_too_long',
    );
  }
}

export async function createMessageTemplate(
  db: Db,
  input: { organizationId: string; name: string; subject: string; body: string },
): Promise<string> {
  const actor = await requireActor(db);
  checkText(input);

  const { data, error } = await db
    .from('message_templates')
    .insert({
      organization_id: input.organizationId,
      name: input.name.trim(),
      subject: input.subject.trim(),
      body: input.body.trim(),
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'This business already has a template with that name.',
        'messages.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('Your role cannot write messages here.', 'messages.forbidden');
    }
    throw new DomainError(error.message, 'messages.create_failed');
  }

  return data.id;
}

/**
 * Change what a template says from now on.
 *
 * **It changes nothing that has been sent.** A delivery carries the finished words, resolved
 * once at the moment it was queued, so editing this cannot reach into somebody's inbox or into
 * the record of what they were told (I8) — the same protection a checklist template and a priced
 * line already have.
 */
export async function updateMessageTemplate(
  db: Db,
  input: { id: string; name: string; subject: string; body: string },
): Promise<void> {
  await requireActor(db);
  checkText(input);

  const { data, error } = await db
    .from('message_templates')
    .update({
      name: input.name.trim(),
      subject: input.subject.trim(),
      body: input.body.trim(),
    })
    .eq('id', input.id)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'This business already has a template with that name.',
        'messages.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('Your role cannot change messages here.', 'messages.forbidden');
    }
    throw new DomainError(error.message, 'messages.update_failed');
  }

  if ((data ?? []).length === 0) {
    throw new DomainError(
      'No such template here, or your role cannot change it.',
      'messages.not_found',
    );
  }
}

export async function deleteMessageTemplate(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { data, error } = await db
    .from('message_templates')
    .delete()
    .eq('id', input.id)
    .select('id');

  if (error) {
    if (error.code === '23503') {
      // A rule still writes from it. Removing it silently would leave that rule failing every
      // time it ran, which is worse than refusing here where somebody can see why.
      throw new DomainError(
        'A rule still writes from this template. Remove that action first.',
        'messages.template_in_use',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('Your role cannot remove messages here.', 'messages.forbidden');
    }
    throw new DomainError(error.message, 'messages.delete_failed');
  }

  if ((data ?? []).length === 0) {
    throw new DomainError(
      'No such template here, or your role cannot remove it.',
      'messages.not_found',
    );
  }
}

/**
 * What has actually been sent, and what is waiting.
 *
 * Read-only from every direction: written by the notify action, marked by the sender, and
 * editable by nobody. There is no update policy and no update grant for a member.
 */
export async function listMessageDeliveries(
  db: Db,
  input: { organizationId: string; subjectId?: string; failedOnly?: boolean; limit?: number },
): Promise<MessageDelivery[]> {
  let query = db
    .from('message_deliveries')
    .select('id, rule_name, channel, recipient, subject_line, body, state, detail, queued_at, sent_at')
    .eq('organization_id', input.organizationId)
    .order('queued_at', { ascending: false })
    .limit(input.limit ?? 50);

  if (input.subjectId) query = query.eq('subject_id', input.subjectId);
  if (input.failedOnly) query = query.eq('state', 'failed');

  const { data, error } = await query;

  if (error) {
    throw new DomainError(error.message, 'messages.deliveries_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    ruleName: row.rule_name,
    channel: row.channel as Channel,
    recipient: row.recipient,
    subjectLine: row.subject_line,
    body: row.body,
    state: row.state as 'queued' | 'sent' | 'failed',
    detail: row.detail,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
  }));
}
