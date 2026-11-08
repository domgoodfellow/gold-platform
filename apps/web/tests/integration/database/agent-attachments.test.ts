import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_QUESTION,
} from '@/lib/domain/assistant/attachment-rules';
import {
  readAttachmentsForQuestion,
  removeAgentAttachment,
  uploadAgentAttachment,
} from '@/lib/domain/assistant/attachments';
import { askQuestion, listAgentConversationRuns } from '@/lib/domain/assistant/questions';
import { createCustomer } from '@/lib/domain/customers/customers';
import { BUCKET, listDocuments, uploadDocument } from '@/lib/domain/documents/documents';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A file attached to an Agent question.
 *
 * `20260929000009` and the AI-tool architecture are the reasoning. What is asserted, and why each is its own claim:
 *
 *   * **The file is a Document, owned by a person.** Same bucket, same table — and readable, in
 *     both, by that person alone. A colleague who shares the business reads nothing of it: not the
 *     row, not the bytes, not a signed link, not a listing of the folder.
 *   * **The path is the ownership.** A row cannot name somebody else's prefix, and storage refuses
 *     a write there, so the check is at the table and the bucket rather than in the upload code.
 *   * **What reaches the model is text**, from the asker's own files only, once.
 *   * **The association persists**, and reopening a conversation shows the files again.
 *   * **Ordinary documents are untouched** — still the whole business's to read.
 *
 * The answering deployment is faked at `fetch`, for its own URL only.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ASSISTANT = 'http://assistant.test';

type Person = { db: SupabaseClient; userId: string; email: string };
type Business = Person & { organizationId: string };

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function newUser(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = anonClient();
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: data.user.id, email };
}

async function newBusiness(label: string): Promise<Business> {
  const person = await newUser(label);
  const organizationId = await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    currency: 'EUR',
    timezone: 'Europe/Amsterdam',
  });
  return { ...person, organizationId };
}

async function newColleague(business: Business, capabilities: string[]): Promise<Person> {
  const person = await newUser('attach-colleague');
  const roleId = await createRole(business.db, {
    organizationId: business.organizationId,
    name: `role-${randomUUID().slice(0, 8)}`,
    capabilities: capabilities as never,
  });
  await addMember(business.db, {
    organizationId: business.organizationId,
    email: person.email,
    displayName: 'Colleague',
    roleId,
  });
  return person;
}

const csv = (name = 'jobs.csv', body = 'id,title\n1,Fence\n2,Gate\n') =>
  new File([body], name, { type: 'text/csv' });

let sent: { question: string; attachments: unknown; history: unknown }[] = [];

function fakeAssistant() {
  const real = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(ASSISTANT)) return real(input, init);
    const body = JSON.parse(String(init?.body));
    sent.push({ question: body.question, attachments: body.attachments, history: body.history });
    return new Response(
      JSON.stringify({ outcome: 'answered', answer: `Read ${body.attachments?.length ?? 0}`, answered_by: 'test', tools: [], action: null }),
      { status: 200 },
    );
  });
  vi.stubEnv('ASSISTANT_API_URL', ASSISTANT);
}

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: CONNECTION });
  await client.connect();
  try {
    return (await client.query(query, params)).rows as T[];
  } finally {
    await client.end();
  }
}

let yard: Business;
let clinic: Business;

beforeAll(async () => {
  yard = await newBusiness('att-yard');
  clinic = await newBusiness('att-clinic');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sent = [];
});

describe('an attachment is a private Document owned by its asker', () => {
  it('stores the bytes under the business and the person, and records the row as theirs', async () => {
    const stored = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv() });

    const [row] = await sql<{
      storage_path: string;
      agent_user_id: string;
      created_by: string;
      mime_type: string;
      size_bytes: string;
      customer_id: string | null;
    }>('select * from public.documents where id = $1', [stored.id]);

    expect(row.storage_path.startsWith(`${yard.organizationId}/agent/${yard.userId}/`)).toBe(true);
    expect(row.agent_user_id).toBe(yard.userId);
    expect(row.created_by).toBe(yard.userId);
    expect(row.mime_type).toBe('text/csv');
    expect(Number(row.size_bytes)).toBe('id,title\n1,Fence\n2,Gate\n'.length);
    // A private file names no record, so no business list can show it.
    const links = await sql<{ id: string }>('select id from public.document_links where document_id = $1', [stored.id]);
    expect(links).toEqual([]);

    // And the bytes are really there, readable by their owner.
    const { data, error } = await yard.db.storage.from(BUCKET).download(row.storage_path);
    expect(error).toBeNull();
    expect(await data!.text()).toBe('id,title\n1,Fence\n2,Gate\n');
  });

  it('is invisible to a colleague — the row, the bytes, a signed link and the folder listing', async () => {
    const stored = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('private.csv') });
    const [{ storage_path }] = await sql<{ storage_path: string }>(
      'select storage_path from public.documents where id = $1',
      [stored.id],
    );
    // A colleague who may ask questions and file documents: the most a member can hold.
    const colleague = await newColleague(yard, ['assistant.ask', 'document.create', 'customer.create']);

    const rows = await colleague.db.from('documents').select('id').eq('id', stored.id);
    expect(rows.data).toEqual([]);

    const download = await colleague.db.storage.from(BUCKET).download(storage_path);
    expect(download.error).not.toBeNull();

    const signed = await colleague.db.storage.from(BUCKET).createSignedUrl(storage_path, 60);
    expect(signed.error).not.toBeNull();

    const listing = await colleague.db.storage
      .from(BUCKET)
      .list(`${yard.organizationId}/agent/${yard.userId}`);
    expect(listing.data ?? []).toEqual([]);

    // The owner still lists it.
    const own = await yard.db.storage.from(BUCKET).list(`${yard.organizationId}/agent/${yard.userId}`);
    expect((own.data ?? []).length).toBeGreaterThan(0);
  });

  it('is invisible to another business', async () => {
    const stored = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('yard-only.csv') });
    const [{ storage_path }] = await sql<{ storage_path: string }>(
      'select storage_path from public.documents where id = $1',
      [stored.id],
    );

    expect((await clinic.db.from('documents').select('id').eq('id', stored.id)).data).toEqual([]);
    expect((await clinic.db.storage.from(BUCKET).download(storage_path)).error).not.toBeNull();
  });

  it('cannot be written into somebody else’s prefix — the bucket refuses, and so does the table', async () => {
    const colleague = await newColleague(yard, ['assistant.ask']);

    // A member uploading straight into another member's private folder.
    const intruding = await colleague.db.storage
      .from(BUCKET)
      .upload(`${yard.organizationId}/agent/${yard.userId}/${randomUUID()}/x.txt`, new Blob(['x']), { upsert: false });
    expect(intruding.error).not.toBeNull();

    // A row naming another member's prefix, even from the owner of the row.
    const forged = await colleague.db.from('documents').insert({
      organization_id: yard.organizationId,
      agent_user_id: colleague.userId,
      created_by: colleague.userId,
      storage_path: `${yard.organizationId}/agent/${yard.userId}/${randomUUID()}/x.txt`,
      file_name: 'x.txt',
      mime_type: 'text/plain',
      size_bytes: 1,
    });
    expect(forged.error).not.toBeNull();

    // A row claiming to be somebody else's file.
    const asSomebodyElse = await colleague.db.from('documents').insert({
      organization_id: yard.organizationId,
      agent_user_id: yard.userId,
      created_by: colleague.userId,
      storage_path: `${yard.organizationId}/agent/${yard.userId}/${randomUUID()}/x.txt`,
      file_name: 'x.txt',
      mime_type: 'text/plain',
      size_bytes: 1,
    });
    expect(asSomebodyElse.error).not.toBeNull();
  });

  it('holds the safe-file rule at the table: only small text, whoever writes the row', async () => {
    const path = () => `${yard.organizationId}/agent/${yard.userId}/${randomUUID()}/x`;
    const row = (patch: Record<string, unknown>) => ({
      organization_id: yard.organizationId,
      agent_user_id: yard.userId,
      created_by: yard.userId,
      storage_path: path(),
      file_name: 'x.txt',
      mime_type: 'text/plain',
      size_bytes: 10,
      ...patch,
    });

    expect((await yard.db.from('documents').insert(row({ mime_type: 'application/pdf' }))).error).not.toBeNull();
    expect((await yard.db.from('documents').insert(row({ mime_type: 'image/png' }))).error).not.toBeNull();
    expect(
      (await yard.db.from('documents').insert(row({ size_bytes: ATTACHMENT_MAX_BYTES + 1 }))).error,
    ).not.toBeNull();
  });

  it('is a person’s own, not a customer’s: it appears in no record’s document list', async () => {
    const customerId = await createCustomer(yard.db, { organizationId: yard.organizationId, name: 'Att Customer' });
    await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('not-a-customer-file.csv') });

    const listed = await listDocuments(yard.db, {
      organizationId: yard.organizationId,
      attachedTo: { entity: 'customer', id: customerId },
    });
    expect(listed.map((doc) => doc.fileName)).not.toContain('not-a-customer-file.csv');
  });

  it('leaves ordinary documents readable by the whole business, as before', async () => {
    const customerId = await createCustomer(yard.db, { organizationId: yard.organizationId, name: 'Shared Customer' });
    const id = await uploadDocument(yard.db, { files: supabaseFileStore(yard.db, BUCKET),
      organizationId: yard.organizationId,
      attachedTo: { entity: 'customer', id: customerId },
      file: new File(['contract'], 'contract.txt', { type: 'text/plain' }),
    });
    const colleague = await newColleague(yard, ['work_item.transition']);

    const seen = await colleague.db.from('documents').select('id').eq('id', id);
    expect(seen.data).toHaveLength(1);
  });
});

describe('a file is refused before it is stored, in words a person can act on', () => {
  const upload = (file: File, business: Pick<Business, 'db' | 'organizationId'> = yard) =>
    uploadAgentAttachment(business.db, { organizationId: business.organizationId, file });

  it('refuses a type the Agent cannot read', async () => {
    await expect(upload(new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' }))).rejects.toThrow(
      /cannot read that kind of file/,
    );
    await expect(upload(new File(['x'], 'photo.png', { type: 'image/png' }))).rejects.toThrow(
      /cannot read that kind of file/,
    );
  });

  it('does not trust the browser’s type: an extension decides, and the bytes must be text', async () => {
    // Says text, is not.
    await expect(
      upload(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])], 'archive.txt', { type: 'text/plain' })),
    ).rejects.toThrow(/not text/);
    // Says it is a PDF, is called `.csv`: stored by what it is called and checked by what it is.
    const stored = await upload(new File(['a,b\n1,2\n'], 'odd.csv', { type: 'application/pdf' }));
    expect(stored.mimeType).toBe('text/csv');
  });

  it('refuses an empty file and one over the size limit', async () => {
    await expect(upload(new File([], 'empty.txt'))).rejects.toThrow(/empty/);
    await expect(upload(new File([new Uint8Array(ATTACHMENT_MAX_BYTES + 1).fill(97)], 'big.txt'))).rejects.toThrow(
      /larger than/,
    );
  });

  it('never lets a name become a path: separators and direction tricks are removed', async () => {
    const stored = await upload(new File(['hi'], '../../etc/pass\u202ewd\u0000.txt', { type: 'text/plain' }));
    expect(stored.fileName).toBe('passwd.txt');

    const [{ storage_path }] = await sql<{ storage_path: string }>(
      'select storage_path from public.documents where id = $1',
      [stored.id],
    );
    expect(storage_path.startsWith(`${yard.organizationId}/agent/${yard.userId}/`)).toBe(true);
    expect(storage_path).not.toContain('..');
    expect(storage_path.split('/')).toHaveLength(5);
  });

  it('refuses a role that cannot ask, and a business the caller is not in — and stores nothing', async () => {
    const mute = await newColleague(yard, ['work_item.transition']);
    const before = await sql<{ n: string }>('select count(*)::text as n from public.documents where agent_user_id = $1', [mute.userId]);

    await expect(upload(csv(), { db: mute.db, organizationId: yard.organizationId })).rejects.toThrow(
      /cannot ask the platform questions/,
    );
    await expect(upload(csv(), { db: clinic.db, organizationId: yard.organizationId })).rejects.toThrow();

    const after = await sql<{ n: string }>('select count(*)::text as n from public.documents where agent_user_id = $1', [mute.userId]);
    expect(after[0].n).toBe(before[0].n);
    const listing = await mute.db.storage.from(BUCKET).list(`${yard.organizationId}/agent/${mute.userId}`);
    expect(listing.data ?? []).toEqual([]);
  });

  it('a failed upload leaves no row behind', async () => {
    const before = await sql<{ n: string }>('select count(*)::text as n from public.documents where agent_user_id = $1', [yard.userId]);

    const failing = vi.spyOn(yard.db.storage, 'from').mockImplementation(() => ({
      upload: async () => ({ data: null, error: { message: 'the storage service is down' } }),
    }) as never);
    await expect(upload(csv('down.csv'))).rejects.toThrow('Something went wrong. Try again.');
    failing.mockRestore();

    const after = await sql<{ n: string }>('select count(*)::text as n from public.documents where agent_user_id = $1', [yard.userId]);
    expect(after[0].n).toBe(before[0].n);
  });
});

describe('taking a file back before it is sent', () => {
  it('deletes the row and the bytes', async () => {
    const stored = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('take-back.csv') });
    const [{ storage_path }] = await sql<{ storage_path: string }>(
      'select storage_path from public.documents where id = $1',
      [stored.id],
    );

    await removeAgentAttachment(yard.db, { organizationId: yard.organizationId, documentId: stored.id });

    expect(await sql('select 1 from public.documents where id = $1', [stored.id])).toEqual([]);
    expect((await yard.db.storage.from(BUCKET).download(storage_path)).error).not.toBeNull();
  });

  it('cannot take back somebody else’s file, or an ordinary document', async () => {
    const stored = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('mine.csv') });
    const colleague = await newColleague(yard, ['assistant.ask']);

    await expect(
      removeAgentAttachment(colleague.db, { organizationId: yard.organizationId, documentId: stored.id }),
    ).rejects.toThrow('That file is not available.');
    expect(await sql('select 1 from public.documents where id = $1', [stored.id])).toHaveLength(1);

    const customerId = await createCustomer(yard.db, { organizationId: yard.organizationId, name: 'Undeletable' });
    const documentId = await uploadDocument(yard.db, { files: supabaseFileStore(yard.db, BUCKET),
      organizationId: yard.organizationId,
      attachedTo: { entity: 'customer', id: customerId },
      file: new File(['keep'], 'keep.txt', { type: 'text/plain' }),
    });
    await expect(
      removeAgentAttachment(yard.db, { organizationId: yard.organizationId, documentId }),
    ).rejects.toThrow('That file is not available.');
    // And nobody can delete an ordinary document directly, either.
    const direct = await yard.db.from('documents').delete().eq('id', documentId).select('id');
    expect(direct.data ?? []).toEqual([]);
    expect(await sql('select 1 from public.documents where id = $1', [documentId])).toHaveLength(1);
  });
});

describe('sending a file with a question', () => {
  it('gives the answering side the file as text, associates it, and shows it again when reopened', async () => {
    fakeAssistant();
    const stored = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('roster.csv') });

    const run = await askQuestion(yard.db, {
      organizationId: yard.organizationId,
      question: 'Who is on the roster?',
      documentIds: [stored.id],
    });

    // Text, named, and nothing else about it.
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toEqual([
      { name: 'roster.csv', mimeType: 'text/csv', text: 'id,title\n1,Fence\n2,Gate\n', truncated: false },
    ]);
    expect(run.attachments.map((file) => file.fileName)).toEqual(['roster.csv']);

    // Persisted: the association is a row, and a fresh read of the conversation carries it.
    const links = await sql('select 1 from public.agent_run_documents where run_id = $1', [run.id]);
    expect(links).toHaveLength(1);

    const reopened = await listAgentConversationRuns(yard.db, {
      organizationId: yard.organizationId,
      conversationId: run.conversationId,
    });
    expect(reopened[0].attachments).toEqual([
      { id: stored.id, fileName: 'roster.csv', mimeType: 'text/csv', sizeBytes: 'id,title\n1,Fence\n2,Gate\n'.length },
    ]);
  });

  it('carries a file with the turn it was sent on, and with no later one', async () => {
    fakeAssistant();
    const first = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('one.csv') });
    const second = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('two.csv') });

    const run = await askQuestion(yard.db, { organizationId: yard.organizationId, question: 'First?', documentIds: [first.id] });
    await askQuestion(yard.db, {
      organizationId: yard.organizationId,
      conversationId: run.conversationId,
      question: 'Second, no file?',
    });
    await askQuestion(yard.db, {
      organizationId: yard.organizationId,
      conversationId: run.conversationId,
      question: 'Third, another file?',
      documentIds: [second.id],
    });

    expect(sent.map((request) => (request.attachments as unknown[]).length)).toEqual([1, 0, 1]);

    const runs = await listAgentConversationRuns(yard.db, {
      organizationId: yard.organizationId,
      conversationId: run.conversationId,
    });
    // Newest first, each turn with its own files.
    expect(runs.map((r) => r.attachments.map((file) => file.fileName))).toEqual([['two.csv'], [], ['one.csv']]);
  });

  it('sends files only to the person who attached them, and only once', async () => {
    fakeAssistant();
    const colleague = await newColleague(yard, ['assistant.ask']);
    const mine = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('mine-only.csv') });

    // A colleague cannot send my file with their question.
    await expect(
      askQuestion(colleague.db, { organizationId: yard.organizationId, question: 'Use theirs', documentIds: [mine.id] }),
    ).rejects.toThrow('One of those files is no longer available.');

    // Nor can I send it twice.
    await askQuestion(yard.db, { organizationId: yard.organizationId, question: 'Once', documentIds: [mine.id] });
    await expect(
      askQuestion(yard.db, { organizationId: yard.organizationId, question: 'Twice', documentIds: [mine.id] }),
    ).rejects.toThrow('One of those files has already been sent.');
    expect(sent.map((request) => request.question)).toEqual(['Once']);
  });

  it('will not send an ordinary document as if it were an attachment', async () => {
    fakeAssistant();
    const customerId = await createCustomer(yard.db, { organizationId: yard.organizationId, name: 'Contract Holder' });
    const documentId = await uploadDocument(yard.db, { files: supabaseFileStore(yard.db, BUCKET),
      organizationId: yard.organizationId,
      attachedTo: { entity: 'customer', id: customerId },
      file: new File(['confidential terms'], 'terms.txt', { type: 'text/plain' }),
    });

    await expect(
      askQuestion(yard.db, { organizationId: yard.organizationId, question: 'Read it', documentIds: [documentId] }),
    ).rejects.toThrow('One of those files is no longer available.');
    expect(sent).toEqual([]);
  });

  it('refuses too many files, and refuses before anything is spent', async () => {
    fakeAssistant();
    const ids: string[] = [];
    for (let n = 0; n <= ATTACHMENTS_PER_QUESTION; n += 1) {
      ids.push((await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv(`n${n}.csv`) })).id);
    }

    await expect(
      askQuestion(yard.db, { organizationId: yard.organizationId, question: 'All of them', documentIds: ids }),
    ).rejects.toThrow(/at most 3 files/);
    expect(sent).toEqual([]);
  });

  it('shortens what it sends, and says so', async () => {
    const long = 'x'.repeat(30_000);
    const stored = await uploadAgentAttachment(yard.db, {
      organizationId: yard.organizationId,
      file: new File([long], 'long.txt', { type: 'text/plain' }),
    });

    const { texts, attachments } = await readAttachmentsForQuestion(yard.db, {
      organizationId: yard.organizationId,
      documentIds: [stored.id],
    });

    expect(attachments).toHaveLength(1);
    expect(texts[0].text).toHaveLength(20_000);
    expect(texts[0].truncated).toBe(true);
  });

  it('a question with no files is unchanged', async () => {
    fakeAssistant();
    const run = await askQuestion(yard.db, { organizationId: yard.organizationId, question: 'Just words' });
    expect(sent[0].attachments).toEqual([]);
    expect(run.attachments).toEqual([]);
  });
});

describe('a link cannot join a question to a file that is not the asker’s', () => {
  it('is refused at the table by the composite keys', async () => {
    fakeAssistant();
    const colleague = await newColleague(yard, ['assistant.ask']);
    const theirs = await askQuestion(colleague.db, { organizationId: yard.organizationId, question: 'Theirs' });
    const mine = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('linked.csv') });

    // My file, their question: neither half of the key matches.
    const crossed = await colleague.db.from('agent_run_documents').insert({
      organization_id: yard.organizationId,
      created_by: colleague.userId,
      run_id: theirs.id,
      document_id: mine.id,
    });
    expect(crossed.error).not.toBeNull();

    // And once sent, the file cannot be deleted out from under the question.
    const run = await askQuestion(yard.db, { organizationId: yard.organizationId, question: 'Mine', documentIds: [mine.id] });
    expect(run.attachments).toHaveLength(1);
    await expect(
      removeAgentAttachment(yard.db, { organizationId: yard.organizationId, documentId: mine.id }),
    ).rejects.toThrow('That file has already been sent.');
    expect(await sql('select 1 from public.documents where id = $1', [mine.id])).toHaveLength(1);
  });

  it('is invisible to a colleague, and to another business', async () => {
    fakeAssistant();
    const stored = await uploadAgentAttachment(yard.db, { organizationId: yard.organizationId, file: csv('seen-by-me.csv') });
    const run = await askQuestion(yard.db, { organizationId: yard.organizationId, question: 'Private', documentIds: [stored.id] });
    const colleague = await newColleague(yard, ['assistant.ask']);

    expect((await colleague.db.from('agent_run_documents').select('run_id').eq('run_id', run.id)).data).toEqual([]);
    expect((await clinic.db.from('agent_run_documents').select('run_id').eq('run_id', run.id)).data).toEqual([]);
    expect(
      await listAgentConversationRuns(colleague.db, {
        organizationId: yard.organizationId,
        conversationId: run.conversationId,
      }),
    ).toEqual([]);
  });
});
