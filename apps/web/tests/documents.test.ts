import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAsset } from '@/lib/domain/assets/assets';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  BUCKET,
  getDocumentUrl,
  listDocuments,
  uploadDocument,
} from '@/lib/domain/documents/documents';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';

/**
 * Document, and the only slice so far with a security surface outside Postgres.
 *
 * Two boundaries have to hold and they are enforced in different places. The metadata row is
 * RLS like everything else. The BYTES are guarded by a storage policy that pins the object
 * key's first path segment to an organization the caller belongs to — so the tests below
 * reach for the storage API directly, because a caller that skips the domain layer is
 * exactly the case the policy exists for.
 *
 * The third property is the one constraints.md is most explicit about: a private file is
 * never served from a durable public URL. There is no public URL at all; a signed one is
 * minted per click and lives sixty seconds.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  customerId: string;
};

let alice: Tenant;
let bob: Tenant;
let aliceDocumentId: string;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
  });
  if (error) throw error;

  const orgId = organizationId as string;

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    customerId: await createCustomer(db, { organizationId: orgId, name: `${label} Customer` }),
  };
}

function fileNamed(name: string, body = 'hello'): File {
  return new File([body], name, { type: 'text/plain' });
}

describe('documents', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('doc-alice');
    bob = await newTenant('doc-bob');
  });

  it('attaches a file to a customer', async () => {
    aliceDocumentId = await uploadDocument(alice.db, {
      organizationId: alice.organizationId,
      attachedTo: { entity: 'customer', id: alice.customerId },
      file: fileNamed('contract.txt'),
    });
    expect(aliceDocumentId).toBeTypeOf('string');

    const documents = await listDocuments(alice.db, {
      organizationId: alice.organizationId,
      attachedTo: { entity: 'customer', id: alice.customerId },
    });
    expect(documents.map((d) => d.fileName)).toEqual(['contract.txt']);
    expect(documents[0].sizeBytes).toBe(5);
  });

  it('stores the bytes under the tenant path prefix', async () => {
    const { data } = await alice.db
      .from('documents')
      .select('storage_path')
      .eq('id', aliceDocumentId)
      .single();

    // The prefix is the boundary, so it is asserted rather than assumed.
    expect(data!.storage_path.startsWith(`${alice.organizationId}/`)).toBe(true);
  });

  it('mints a signed, expiring URL rather than a durable one', async () => {
    const { url } = await getDocumentUrl(alice.db, { documentId: aliceDocumentId });

    expect(url).toContain('/object/sign/');
    expect(url).toContain('token=');

    // And it actually serves the bytes.
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
  });

  it('does not serve the same object without a signature', async () => {
    const { data } = await alice.db
      .from('documents')
      .select('storage_path')
      .eq('id', aliceDocumentId)
      .single();

    // The public URL shape for a private bucket. If this ever returns the bytes, the bucket
    // has been made public and the whole posture is gone.
    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${data!.storage_path}`,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('hides one tenant\'s documents from the other', async () => {
    const theirs = await listDocuments(bob.db, {
      organizationId: bob.organizationId,
      attachedTo: { entity: 'customer', id: bob.customerId },
    });
    expect(theirs).toEqual([]);

    await expect(
      getDocumentUrl(bob.db, { documentId: aliceDocumentId }),
    ).rejects.toMatchObject({ code: 'documents.not_found' });
  });

  it('refuses to write bytes into another tenant\'s prefix', async () => {
    // Straight at the storage API, skipping the domain layer entirely. This is the case the
    // policy exists for: nothing in TypeScript is between this call and the bucket.
    const { error } = await bob.db.storage
      .from(BUCKET)
      .upload(`${alice.organizationId}/${randomUUID()}/stolen.txt`, fileNamed('x'));

    expect(error).not.toBeNull();
  });

  it('refuses to read bytes from another tenant\'s prefix', async () => {
    const { data } = await alice.db
      .from('documents')
      .select('storage_path')
      .eq('id', aliceDocumentId)
      .single();

    const { error } = await bob.db.storage.from(BUCKET).download(data!.storage_path);
    expect(error).not.toBeNull();
  });

  it('cannot sign a URL for another tenant\'s object', async () => {
    const { data } = await alice.db
      .from('documents')
      .select('storage_path')
      .eq('id', aliceDocumentId)
      .single();

    const { error } = await bob.db.storage
      .from(BUCKET)
      .createSignedUrl(data!.storage_path, 60);
    expect(error).not.toBeNull();
  });

  it('cannot attach a document to another tenant\'s customer (I18)', async () => {
    await expect(
      uploadDocument(alice.db, {
        organizationId: alice.organizationId,
        attachedTo: { entity: 'customer', id: bob.customerId },
        file: fileNamed('borrowed.txt'),
      }),
    ).rejects.toMatchObject({ code: 'documents.owner_not_found' });
  });

  it('insists a document belongs to exactly one thing', async () => {
    // The domain layer cannot express two owners, so this goes straight at the table.
    const assetId = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Compressor',
    });

    const { error: bothError } = await alice.db.from('documents').insert({
      organization_id: alice.organizationId,
      customer_id: alice.customerId,
      asset_id: assetId,
      storage_path: `${alice.organizationId}/${randomUUID()}/two-owners.txt`,
      file_name: 'two-owners.txt',
      mime_type: 'text/plain',
      size_bytes: 1,
      created_by: alice.userId,
    });
    expect(bothError?.code).toBe('23514');

    const { error: neitherError } = await alice.db.from('documents').insert({
      organization_id: alice.organizationId,
      storage_path: `${alice.organizationId}/${randomUUID()}/no-owner.txt`,
      file_name: 'no-owner.txt',
      mime_type: 'text/plain',
      size_bytes: 1,
      created_by: alice.userId,
    });
    expect(neitherError?.code).toBe('23514');
  });

  it('attaches to an asset as readily as to a customer', async () => {
    const assetId = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Boiler',
    });

    await uploadDocument(alice.db, {
      organizationId: alice.organizationId,
      attachedTo: { entity: 'asset', id: assetId },
      file: fileNamed('manual.txt'),
    });

    const onAsset = await listDocuments(alice.db, {
      organizationId: alice.organizationId,
      attachedTo: { entity: 'asset', id: assetId },
    });
    expect(onAsset.map((d) => d.fileName)).toEqual(['manual.txt']);

    // And it does not leak into the customer's list.
    const onCustomer = await listDocuments(alice.db, {
      organizationId: alice.organizationId,
      attachedTo: { entity: 'customer', id: alice.customerId },
    });
    expect(onCustomer.map((d) => d.fileName)).toEqual(['contract.txt']);
  });

  it('refuses an empty file', async () => {
    await expect(
      uploadDocument(alice.db, {
        organizationId: alice.organizationId,
        attachedTo: { entity: 'customer', id: alice.customerId },
        file: fileNamed('empty.txt', ''),
      }),
    ).rejects.toMatchObject({ code: 'documents.empty' });
  });

  it('refuses documents to a member without the capability (I12)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Documents',
      capabilities: ['role.manage', 'customer.create'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      uploadDocument(bob.db, {
        organizationId: bob.organizationId,
        attachedTo: { entity: 'customer', id: bob.customerId },
        file: fileNamed('nope.txt'),
      }),
    ).rejects.toMatchObject({ code: 'documents.forbidden' });
  });

  it('records documents on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'document.created');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const event of data!) {
      expect(event.actor_id).toBe(alice.userId);
    }
  });
});
