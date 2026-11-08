import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { BUCKET } from '@/lib/domain/documents/documents';
import {
  ATTACHMENTS_PER_QUESTION,
  boundAttachmentTexts,
  decodeText,
  validateAttachment,
  type AgentAttachment,
  type AttachmentText,
} from './attachment-rules';

export type { AgentAttachment, AttachmentText };

/**
 * A file somebody hands the Agent with a question.
 *
 * **The file is a Document** — the same private bucket, the same `documents` table, the same
 * signed-access rules — owned by the person rather than by a customer or a job, so that only they
 * can read it (the AI-tool architecture: an answer, and what it was answered from, is readable by its asker alone). The
 * reasoning is in `20260929000009`. Nothing here is a second file store.
 *
 * **What the model receives is text, and only text.** Nothing in this codebase extracts text from
 * a PDF or reads an image, so the supported set is exactly the four types whose bytes are already
 * text: plain text, Markdown, CSV and JSON. A type is added the day the reader that consumes it
 * exists, together with it and never before — a file the Agent cannot read would be a control that
 * looks finished and does nothing. Raw binary is never sent to a model.
 */

const COLUMNS = 'id, file_name, mime_type, size_bytes';

function toAttachment(row: { id: string; file_name: string; mime_type: string; size_bytes: number }): AgentAttachment {
  return { id: row.id, fileName: row.file_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) };
}

/** The key inside the bucket. Begins with the business and the person, which is what the storage policy and the table's check read. */
function storageKey(organizationId: string, userId: string, fileName: string): string {
  const segment = fileName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';
  return `${organizationId}/agent/${userId}/${globalThis.crypto.randomUUID()}/${segment}`;
}

/**
 * Store one file privately and record that it is this person's. Bytes first, then the row, for the
 * reason `uploadDocument` gives; and if the row is refused the bytes are removed again. Runs under
 * the caller's own JWT, so the storage policy that pins the path to them is the thing that decides.
 */
export async function uploadAgentAttachment(
  db: Db,
  input: { organizationId: string; file: File },
): Promise<AgentAttachment> {
  const actor = await requireActor(db);

  // Before anything is stored: an attachment is part of a question, so the capability to ask is
  // the one that matters, not the one to file documents.
  const organization = await getOrganization(db, input.organizationId);
  if (!organization) throw new DomainError('No such business.', 'assistant.not_found');
  if (!organization.capabilities.includes('assistant.ask')) {
    throw new DomainError('Your role cannot ask the platform questions.', 'assistant.not_permitted');
  }

  const checked = validateAttachment({ name: input.file.name, size: input.file.size });
  if (checked.error !== null) throw new DomainError(checked.error, 'assistant.attachment_invalid');

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  if (decodeText(bytes) === null) {
    throw new DomainError('That file is not text the Agent can read.', 'assistant.attachment_not_text');
  }

  const path = storageKey(input.organizationId, actor.id, checked.fileName);
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: checked.mimeType, upsert: false });
  if (uploadError) throw fromDatabaseError(uploadError, 'assistant.attachment_upload_failed');

  const { data, error } = await db
    .from('documents')
    .insert({
      organization_id: input.organizationId,
      agent_user_id: actor.id,
      created_by: actor.id,
      storage_path: path,
      file_name: checked.fileName,
      mime_type: checked.mimeType,
      size_bytes: bytes.byteLength,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    throw fromDatabaseError(error, 'assistant.attachment_record_failed');
  }
  return toAttachment(data);
}

/**
 * Take a file back before it is sent. Only the owner's, only an Agent file, and only while no
 * question has been sent with it — the delete policy says all three, so a file that was sent, or
 * somebody else's, deletes nothing and is reported as gone.
 */
export async function removeAgentAttachment(
  db: Db,
  input: { organizationId: string; documentId: string },
): Promise<void> {
  await requireActor(db);

  const { data: row } = await db
    .from('documents')
    .select('storage_path')
    .eq('organization_id', input.organizationId)
    .eq('id', input.documentId)
    .not('agent_user_id', 'is', null)
    .maybeSingle();
  if (!row) throw new DomainError('That file is not available.', 'assistant.attachment_not_found');

  const { data: removed, error } = await db
    .from('documents')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('id', input.documentId)
    .select('id');
  if (error) throw fromDatabaseError(error, 'assistant.attachment_remove_failed');
  if (!removed || removed.length === 0) {
    throw new DomainError('That file has already been sent.', 'assistant.attachment_sent');
  }

  // Best effort: the row is the authority, and bytes with no row are unreachable.
  await db.storage.from(BUCKET).remove([row.storage_path]);
}

/**
 * The files to send with a question: this person's own, not yet sent, at most a few — and their
 * text, read back under their own token. Refuses the whole question rather than quietly dropping
 * one, because an answer given without a file the person believes it read is worse than no answer.
 */
export async function readAttachmentsForQuestion(
  db: Db,
  input: { organizationId: string; documentIds: string[] },
): Promise<{ attachments: AgentAttachment[]; texts: AttachmentText[] }> {
  const ids = [...new Set(input.documentIds)];
  if (ids.length === 0) return { attachments: [], texts: [] };
  if (ids.length > ATTACHMENTS_PER_QUESTION) {
    throw new DomainError(
      `Attach at most ${ATTACHMENTS_PER_QUESTION} files to one question.`,
      'assistant.attachment_too_many',
    );
  }

  // `agent_user_id is not null` is what keeps this to Agent files: an ordinary document's id is a
  // valid id in the same table, and is not something a question may be sent with.
  const { data, error } = await db
    .from('documents')
    .select(`${COLUMNS}, storage_path`)
    .eq('organization_id', input.organizationId)
    .not('agent_user_id', 'is', null)
    .in('id', ids);
  if (error) throw fromDatabaseError(error, 'assistant.attachment_read_failed');
  if ((data ?? []).length !== ids.length) {
    throw new DomainError('One of those files is no longer available.', 'assistant.attachment_not_found');
  }

  const { data: sent } = await db
    .from('agent_run_documents')
    .select('document_id')
    .eq('organization_id', input.organizationId)
    .in('document_id', ids);
  if ((sent ?? []).length > 0) {
    throw new DomainError('One of those files has already been sent.', 'assistant.attachment_sent');
  }

  // In the order they were attached, whatever order the database returned them in.
  const rows = ids.map((id) => data!.find((row) => row.id === id)!);
  const texts: AttachmentText[] = [];
  for (const row of rows) {
    const { data: blob, error: downloadError } = await db.storage.from(BUCKET).download(row.storage_path);
    if (downloadError || !blob) {
      throw new DomainError('One of those files could not be read.', 'assistant.attachment_read_failed');
    }
    const text = decodeText(new Uint8Array(await blob.arrayBuffer()));
    if (text === null) {
      throw new DomainError('One of those files is not text the Agent can read.', 'assistant.attachment_not_text');
    }
    texts.push({ name: row.file_name, mimeType: row.mime_type, text, truncated: false });
  }

  return { attachments: rows.map(toAttachment), texts: boundAttachmentTexts(texts) };
}

/** Record which files a question was sent with. */
export async function linkAttachmentsToRun(
  db: Db,
  input: { organizationId: string; userId: string; runId: string; documentIds: string[] },
): Promise<void> {
  if (input.documentIds.length === 0) return;
  const { error } = await db.from('agent_run_documents').insert(
    input.documentIds.map((documentId) => ({
      organization_id: input.organizationId,
      created_by: input.userId,
      run_id: input.runId,
      document_id: documentId,
    })),
  );
  if (error) throw fromDatabaseError(error, 'assistant.attachment_link_failed');
}

/** The files each of these questions was sent with — what a reopened conversation shows again. */
export async function listAttachmentsByRun(
  db: Db,
  input: { organizationId: string; runIds: string[] },
): Promise<Map<string, AgentAttachment[]>> {
  const byRun = new Map<string, AgentAttachment[]>();
  if (input.runIds.length === 0) return byRun;

  const { data: links, error } = await db
    .from('agent_run_documents')
    .select('run_id, document_id, created_at')
    .eq('organization_id', input.organizationId)
    .in('run_id', input.runIds)
    .order('created_at', { ascending: true });
  if (error) throw fromDatabaseError(error, 'assistant.attachment_read_failed');
  if (!links || links.length === 0) return byRun;

  const { data: documents, error: documentsError } = await db
    .from('documents')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .in('id', links.map((link) => link.document_id));
  if (documentsError) throw fromDatabaseError(documentsError, 'assistant.attachment_read_failed');

  const known = new Map((documents ?? []).map((row) => [row.id, toAttachment(row)]));
  for (const link of links) {
    const attachment = known.get(link.document_id);
    if (!attachment) continue;
    byRun.set(link.run_id, [...(byRun.get(link.run_id) ?? []), attachment]);
  }
  return byRun;
}
