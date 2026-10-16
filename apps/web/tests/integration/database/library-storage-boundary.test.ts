import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { BUCKET, uploadDocument } from '@/lib/domain/documents/documents';
import { uploadImportFile } from '@/lib/domain/integrations/resources';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The storage boundary Library stands on (slice 13.2). Each test goes straight at the bucket or at
 * the domain door, because the point is what the database refuses when the application is bypassed.
 *
 * Removal is the important half. Before this slice any member could delete any object under the
 * organization's prefix, which left a document row pointing at nothing. Now bytes can be removed only
 * by the person who uploaded them and only while nothing names their path.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Member = { db: SupabaseClient; userId: string; email: string };
type Business = Member & { organizationId: string; customerId: string };

let pg: Client;
let founder: Business;
let colleague: Member;

async function signedIn(label: string): Promise<Member> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

function textFile(name: string, body = 'hello', type = 'text/plain'): File {
  return new File([body], name, { type });
}

async function canDownload(db: SupabaseClient, path: string): Promise<boolean> {
  const { error } = await db.storage.from(BUCKET).download(path);
  return error === null;
}

describe('the documents bucket', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();

    const owner = await signedIn('storage-founder');
    const organizationId = (await foundBusiness({
      ownerEmail: owner.email,
      name: 'Storage Ltd',
      displayName: 'Founder',
      timezone: 'UTC',
      currency: 'EUR',
    })) as string;
    const customerId = await createCustomer(owner.db, { organizationId, name: 'Storage Customer' });
    founder = { ...owner, organizationId, customerId };

    // A colleague with upload authority but not the owner's role: the case the uploader-only rule is for.
    colleague = await signedIn('storage-colleague');
    const { rows } = await pg.query(
      `insert into public.roles (organization_id, name, capabilities, created_by)
       values ($1, 'Uploader', array['document.create']::text[], $2) returning id`,
      [organizationId, founder.userId],
    );
    await pg.query(
      `insert into public.memberships (organization_id, user_id, role_id, display_name, created_by)
       values ($1, $2, $3, 'Colleague', $4)`,
      [organizationId, colleague.userId, rows[0].id, founder.userId],
    );
  });

  afterAll(async () => {
    await pg?.end();
  });

  describe('removal', () => {
    it('lets the uploader remove bytes that no row points at', async () => {
      const path = `${founder.organizationId}/${randomUUID()}/orphan.txt`;
      const { error: uploadError } = await founder.db.storage.from(BUCKET).upload(path, textFile('orphan.txt'));
      expect(uploadError).toBeNull();

      await founder.db.storage.from(BUCKET).remove([path]);

      expect(await canDownload(founder.db, path)).toBe(false);
    });

    it('keeps the bytes of a stored document, even when its uploader asks', async () => {
      const documentId = await uploadDocument(founder.db, { files: supabaseFileStore(founder.db, BUCKET),
        organizationId: founder.organizationId,
        attachedTo: { entity: 'customer', id: founder.customerId },
        file: textFile('kept.txt', 'kept'),
      });
      const { data: row } = await founder.db.from('documents').select('storage_path').eq('id', documentId).single();

      await founder.db.storage.from(BUCKET).remove([row!.storage_path]);

      expect(await canDownload(founder.db, row!.storage_path)).toBe(true);
    });

    it('does not let another member remove an uploader\'s orphan', async () => {
      const path = `${founder.organizationId}/${randomUUID()}/mine.txt`;
      const { error: uploadError } = await founder.db.storage.from(BUCKET).upload(path, textFile('mine.txt'));
      expect(uploadError).toBeNull();

      await colleague.db.storage.from(BUCKET).remove([path]);

      expect(await canDownload(founder.db, path)).toBe(true);
    });

    it('keeps the bytes of an import file that an integration resource names', async () => {
      const csv = new File(['name,email\nAda,ada@example.test\n'], 'customers.csv', { type: 'text/csv' });
      const { resourceId } = await uploadImportFile(founder.db, { files: supabaseFileStore(founder.db, BUCKET), organizationId: founder.organizationId, file: csv });
      const { data: resource } = await founder.db
        .from('integration_resources')
        .select('storage_path')
        .eq('id', resourceId)
        .single();

      await founder.db.storage.from(BUCKET).remove([resource!.storage_path]);

      expect(await canDownload(founder.db, resource!.storage_path)).toBe(true);
    });

    it('refuses removal from another organization\'s prefix', async () => {
      const stranger = await signedIn('storage-stranger');
      const path = `${founder.organizationId}/${randomUUID()}/elsewhere.txt`;
      await founder.db.storage.from(BUCKET).upload(path, textFile('elsewhere.txt'));

      await stranger.db.storage.from(BUCKET).remove([path]);

      expect(await canDownload(founder.db, path)).toBe(true);
    });
  });

  describe('what it accepts', () => {
    it('refuses a content type the bucket does not allow, whatever the name says', async () => {
      const { error } = await founder.db.storage
        .from(BUCKET)
        .upload(
          `${founder.organizationId}/${randomUUID()}/tool.txt`,
          new Blob(['MZ'], { type: 'application/x-msdownload' }),
          { contentType: 'application/x-msdownload' },
        );
      expect(error).not.toBeNull();
    });

    it('refuses a file whose first bytes are not the kind its name claims', async () => {
      await expect(
        uploadDocument(founder.db, { files: supabaseFileStore(founder.db, BUCKET),
          organizationId: founder.organizationId,
          attachedTo: { entity: 'customer', id: founder.customerId },
          file: textFile('contract.pdf', 'hello'),
        }),
      ).rejects.toMatchObject({ code: 'documents.content_mismatch' });
    });

    it('refuses a kind of file the library does not accept, including SVG', async () => {
      await expect(
        uploadDocument(founder.db, { files: supabaseFileStore(founder.db, BUCKET),
          organizationId: founder.organizationId,
          attachedTo: { entity: 'customer', id: founder.customerId },
          file: textFile('setup.exe', 'MZ'),
        }),
      ).rejects.toMatchObject({ code: 'documents.unsupported' });

      await expect(
        uploadDocument(founder.db, { files: supabaseFileStore(founder.db, BUCKET),
          organizationId: founder.organizationId,
          attachedTo: { entity: 'customer', id: founder.customerId },
          file: textFile('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml'),
        }),
      ).rejects.toMatchObject({ code: 'documents.unsupported' });
    });

    it('accepts a PDF whose signature is a PDF', async () => {
      const id = await uploadDocument(founder.db, { files: supabaseFileStore(founder.db, BUCKET),
        organizationId: founder.organizationId,
        attachedTo: { entity: 'customer', id: founder.customerId },
        file: textFile('brochure.pdf', '%PDF-1.4\n%%EOF\n', 'application/pdf'),
      });
      expect(id).toBeTypeOf('string');
    });

    it('stores the type the name implies, not the one the browser claimed', async () => {
      const id = await uploadDocument(founder.db, { files: supabaseFileStore(founder.db, BUCKET),
        organizationId: founder.organizationId,
        attachedTo: { entity: 'customer', id: founder.customerId },
        file: textFile('notes.md', '# Notes', 'application/octet-stream'),
      });
      const { data } = await founder.db.from('documents').select('mime_type').eq('id', id).single();
      expect(data?.mime_type).toBe('text/markdown');
    });

    it('records a checksum of the bytes as they were stored', async () => {
      const id = await uploadDocument(founder.db, { files: supabaseFileStore(founder.db, BUCKET),
        organizationId: founder.organizationId,
        attachedTo: { entity: 'customer', id: founder.customerId },
        file: textFile('hello.txt', 'hello'),
      });
      const { data } = await founder.db.from('documents').select('content_sha256').eq('id', id).single();
      // sha256("hello")
      expect(data?.content_sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });

  describe('the storage check', () => {
    it('refuses a checksum that is not a sha-256 hex digest', async () => {
      const { error } = await founder.db.rpc('create_document', {
        p_organization_id: founder.organizationId,
        p_customer_id: null,
        p_location_id: null,
        p_asset_id: null,
        p_work_item_id: null,
        p_storage_path: `${founder.organizationId}/${randomUUID()}/bad-sum.txt`,
        p_file_name: 'bad-sum.txt',
        p_mime_type: 'text/plain',
        p_size_bytes: 1,
        p_content_sha256: 'not-a-digest',
      });
      expect(error?.code).toBe('23514');
    });
  });
});
