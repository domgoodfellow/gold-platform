import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';
import { createAsset } from '@/lib/domain/assets/assets';
import { createCustomer } from '@/lib/domain/customers/customers';
import { BUCKET, uploadDocument } from '@/lib/domain/documents/documents';
import {
  libraryFileFilter,
  listLibraryFiles,
  readLibraryFile,
  readLibrarySummary,
} from '@/lib/domain/documents/library-files';
import { uploadAgentAttachment } from '@/lib/domain/assistant/attachments';
import { Client } from 'pg';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The Library's Files list. Every answer here is a database answer (filters, usage, paging and totals
 * run in SQL), so each test asserts what the database returned for a real organization.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Business = { db: SupabaseClient; userId: string; organizationId: string; customerId: string };

let pg: Client;
let owner: Business;
let stranger: Business;
let contractId: string;
let manualId: string;
let agentFileId: string;

async function newBusiness(label: string): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = (await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  })) as string;
  const customerId = await createCustomer(db, { organizationId, name: `${label} Customer` });
  return { db, userId: created.data.user.id, organizationId, customerId };
}

/** Records a file's metadata the way the upload does, without writing bytes: enough for the list. */
async function record(
  business: Business,
  file: { name: string; mimeType: string; size: number; customerId?: string | null; assetId?: string | null },
): Promise<string> {
  const { data, error } = await business.db.rpc('create_document', {
    p_organization_id: business.organizationId,
    p_customer_id: file.customerId ?? null,
    p_location_id: null,
    p_asset_id: file.assetId ?? null,
    p_work_item_id: null,
    p_storage_path: `${business.organizationId}/${randomUUID()}/${file.name}`,
    p_file_name: file.name,
    p_mime_type: file.mimeType,
    p_size_bytes: file.size,
  });
  if (error) throw error;
  return data as string;
}

const all = (business: Business, query: Record<string, string> = {}) =>
  listLibraryFiles(business.db, { organizationId: business.organizationId, filter: libraryFileFilter(query) });

describe('the Library file list', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();

    owner = await newBusiness('files-owner');
    stranger = await newBusiness('files-stranger');

    const asset = await createAsset(owner.db, { organizationId: owner.organizationId, name: 'Compressor' });

    contractId = await record(owner, { name: 'Contract.pdf', mimeType: 'application/pdf', size: 2000, customerId: owner.customerId });
    manualId = await record(owner, { name: 'Manual.pdf', mimeType: 'application/pdf', size: 9000, assetId: asset });
    await record(owner, { name: 'Price list.csv', mimeType: 'text/csv', size: 100 });
    await record(owner, { name: 'Hero.png', mimeType: 'image/png', size: 5000 });

    const agent = await uploadAgentAttachment(owner.db, {
      organizationId: owner.organizationId,
      file: new File(['what is the price?'], 'notes.txt', { type: 'text/plain' }),
    });
    agentFileId = agent.id;
  });

  afterAll(async () => {
    await pg?.end();
  });

  it('lists the business\'s files, and never an Agent-private file', async () => {
    const { rows, total } = await all(owner);
    expect(total).toBe(4);
    expect(rows.map((row) => row.fileName)).not.toContain('notes.txt');
  });

  it('summarizes the files, their size, and how many no record uses', async () => {
    const summary = await readLibrarySummary(owner.db, { organizationId: owner.organizationId });
    expect(summary).toEqual({ fileCount: 4, totalBytes: 16100, unusedCount: 2 });
  });

  it('searches file names without regard to case', async () => {
    const { rows } = await all(owner, { q: 'CONTRACT' });
    expect(rows.map((row) => row.fileName)).toEqual(['Contract.pdf']);
  });

  it('filters by a family of types', async () => {
    const documents = await all(owner, { family: 'documents' });
    expect(documents.rows.map((row) => row.fileName).sort()).toEqual(['Contract.pdf', 'Manual.pdf']);

    const images = await all(owner, { family: 'images' });
    expect(images.rows.map((row) => row.fileName)).toEqual(['Hero.png']);
  });

  it('separates files no record uses from files that are', async () => {
    const unused = await all(owner, { usage: 'unused' });
    expect(unused.rows.map((row) => row.fileName).sort()).toEqual(['Hero.png', 'Price list.csv']);
    expect(unused.rows.every((row) => row.linkCount === 0)).toBe(true);

    const linked = await all(owner, { usage: 'linked' });
    expect(linked.rows.map((row) => row.fileName).sort()).toEqual(['Contract.pdf', 'Manual.pdf']);
    expect(linked.rows.every((row) => row.linkCount === 1)).toBe(true);
  });

  it('sorts by name and by size', async () => {
    const byName = await all(owner, { sort: 'name' });
    expect(byName.rows.map((row) => row.fileName)).toEqual(['Contract.pdf', 'Hero.png', 'Manual.pdf', 'Price list.csv']);

    const largest = await all(owner, { sort: 'largest' });
    expect(largest.rows[0].fileName).toBe('Manual.pdf');
  });

  it('reads a page at a time, with the total before paging', async () => {
    const paged = await createPagingBusiness();
    const first = await all(paged, { page: '1' });
    expect(first.total).toBe(30);
    expect(first.rows).toHaveLength(25);

    const second = await all(paged, { page: '2' });
    expect(second.total).toBe(30);
    expect(second.rows).toHaveLength(5);
    expect(second.rows.map((row) => row.id)).not.toEqual(expect.arrayContaining(first.rows.map((row) => row.id)));
  });

  it('shows another organization nothing, and a file of its own only as absent', async () => {
    const { rows, total } = await all(stranger);
    expect(total).toBe(0);
    expect(rows).toEqual([]);

    const foreign = await readLibraryFile(stranger.db, { organizationId: stranger.organizationId, fileId: contractId });
    expect(foreign).toBeNull();
  });

  it('names the records a file is used by', async () => {
    const contract = await readLibraryFile(owner.db, { organizationId: owner.organizationId, fileId: contractId });
    expect(contract?.uses).toEqual([{ kind: 'customer', id: owner.customerId, label: 'files-owner Customer' }]);

    const manual = await readLibraryFile(owner.db, { organizationId: owner.organizationId, fileId: manualId });
    expect(manual?.uses).toEqual([expect.objectContaining({ kind: 'asset', label: 'Compressor' })]);
  });

  it('does not open an Agent-private file as a Library file, even for the person who attached it', async () => {
    const detail = await readLibraryFile(owner.db, { organizationId: owner.organizationId, fileId: agentFileId });
    expect(detail).toBeNull();
  });

  it('adds a file that no record names, and it is listed as unused', async () => {
    const id = await uploadDocument(owner.db, {
      organizationId: owner.organizationId,
      file: new File(['plain'], 'loose.txt', { type: 'text/plain' }),
      files: supabaseFileStore(owner.db, BUCKET),
    });
    const detail = await readLibraryFile(owner.db, { organizationId: owner.organizationId, fileId: id });
    expect(detail?.uses).toEqual([]);
    const unused = await all(owner, { usage: 'unused' });
    expect(unused.rows.map((row) => row.fileName)).toContain('loose.txt');
  });
});

async function createPagingBusiness(): Promise<Business> {
  if (pagingBusiness) return pagingBusiness;
  pagingBusiness = await newBusiness('files-paging');
  for (let index = 0; index < 30; index += 1) {
    await record(pagingBusiness, { name: `Batch ${String(index).padStart(2, '0')}.txt`, mimeType: 'text/plain', size: 10 });
  }
  return pagingBusiness;
}
let pagingBusiness: Business | null = null;
