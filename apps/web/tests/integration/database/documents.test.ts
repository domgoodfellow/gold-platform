import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';
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
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

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

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

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
    aliceDocumentId = await uploadDocument(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
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
    const { url } = await getDocumentUrl(alice.db, { files: supabaseFileStore(alice.db, BUCKET), documentId: aliceDocumentId });

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
      getDocumentUrl(bob.db, { files: supabaseFileStore(bob.db, BUCKET), documentId: aliceDocumentId }),
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
      uploadDocument(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
        organizationId: alice.organizationId,
        attachedTo: { entity: 'customer', id: bob.customerId },
        file: fileNamed('borrowed.txt'),
      }),
    ).rejects.toMatchObject({ code: 'documents.owner_not_found' });
  });

  it('stores a Library file that no record references yet', async () => {
    // The file is organization-owned, so it exists before anything points at it.
    const { data: unlinkedId, error } = await alice.db.rpc('create_document', {
      p_organization_id: alice.organizationId,
      p_customer_id: null,
      p_location_id: null,
      p_asset_id: null,
      p_work_item_id: null,
      p_storage_path: `${alice.organizationId}/${randomUUID()}/unlinked.txt`,
      p_file_name: 'unlinked.txt',
      p_mime_type: 'text/plain',
      p_size_bytes: 1,
    });
    expect(error).toBeNull();

    const { data: links } = await alice.db
      .from('document_links')
      .select('id')
      .eq('document_id', unlinkedId as string);
    expect(links).toEqual([]);

    const { data: visible } = await bob.db.from('documents').select('id').eq('id', unlinkedId as string);
    expect(visible).toEqual([]);
    const { data: ownVisible } = await alice.db.from('documents').select('id').eq('id', unlinkedId as string);
    expect(ownVisible).toHaveLength(1);
  });

  it('lets one file be referenced by two records without duplicating it', async () => {
    const assetId = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Compressor',
    });

    const { error } = await alice.db.from('document_links').insert({
      organization_id: alice.organizationId,
      document_id: aliceDocumentId,
      asset_id: assetId,
      created_by: alice.userId,
    });
    expect(error).toBeNull();

    const forCustomer = await listDocuments(alice.db, {
      organizationId: alice.organizationId,
      attachedTo: { entity: 'customer', id: alice.customerId },
    });
    const forAsset = await listDocuments(alice.db, {
      organizationId: alice.organizationId,
      attachedTo: { entity: 'asset', id: assetId },
    });
    expect(forCustomer.map((d) => d.id)).toEqual([aliceDocumentId]);
    expect(forAsset.map((d) => d.id)).toEqual([aliceDocumentId]);
  });

  it('refuses a link naming more than one record', async () => {
    const assetId = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Pump',
    });

    const { error } = await alice.db.from('document_links').insert({
      organization_id: alice.organizationId,
      document_id: aliceDocumentId,
      customer_id: alice.customerId,
      asset_id: assetId,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23514');
  });

  it('refuses the same file linked to the same record twice', async () => {
    const { error } = await alice.db.from('document_links').insert({
      organization_id: alice.organizationId,
      document_id: aliceDocumentId,
      customer_id: alice.customerId,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23505');
  });

  it('refuses a link across tenants, in either direction (I18)', async () => {
    // Bob cannot see Alice's file, and Alice's file cannot be linked to Bob's customer.
    const { error: intoBob } = await bob.db.from('document_links').insert({
      organization_id: bob.organizationId,
      document_id: aliceDocumentId,
      customer_id: bob.customerId,
      created_by: bob.userId,
    });
    expect(intoBob).not.toBeNull();

    const { error: toAliceFromBob } = await alice.db.from('document_links').insert({
      organization_id: alice.organizationId,
      document_id: aliceDocumentId,
      customer_id: bob.customerId,
      created_by: alice.userId,
    });
    expect(toAliceFromBob?.code).toBe('23503');
  });

  it('attaches to an asset as readily as to a customer', async () => {
    const assetId = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Boiler',
    });

    await uploadDocument(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
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
      uploadDocument(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
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
      uploadDocument(bob.db, { files: supabaseFileStore(bob.db, BUCKET),
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

  it('carries the attachment target in the event payload, not just the document\'s own id (20260917000001)', async () => {
    // `entity_id` on a document.created event is the document's own id — never the customer's
    // or the asset's — so the payload is the only place a reader can learn which record this
    // upload belongs to. Without it, no timeline can ever attribute the event.
    const documentId = await uploadDocument(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
      organizationId: alice.organizationId,
      attachedTo: { entity: 'customer', id: alice.customerId },
      file: fileNamed('attribution-check.txt'),
    });

    const { data, error } = await alice.db
      .from('events')
      .select('entity_type, payload')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'document.created')
      .eq('entity_id', documentId)
      .single();

    expect(error).toBeNull();
    // The subject is still the document — this is the same precedent `location.linked` set
    // for carrying an owner in the payload rather than changing what the event is about.
    expect(data!.entity_type).toBe('document');
    expect(data!.payload).toMatchObject({ customer_id: alice.customerId });
    // Exactly one owner key travels — the other three are null-stripped, not present as null.
    expect(data!.payload).not.toHaveProperty('location_id');
    expect(data!.payload).not.toHaveProperty('asset_id');
    expect(data!.payload).not.toHaveProperty('work_item_id');
  });

  it('attributes an asset\'s document to the asset, not a customer, in its payload', async () => {
    const assetId = await createAsset(alice.db, {
      organizationId: alice.organizationId,
      name: 'Attributed compressor',
    });
    const documentId = await uploadDocument(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
      organizationId: alice.organizationId,
      attachedTo: { entity: 'asset', id: assetId },
      file: fileNamed('asset-manual.txt'),
    });

    const { data, error } = await alice.db
      .from('events')
      .select('payload')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'document.created')
      .eq('entity_id', documentId)
      .single();

    expect(error).toBeNull();
    expect(data!.payload).toMatchObject({ asset_id: assetId });
    expect(data!.payload).not.toHaveProperty('customer_id');
  });
});
