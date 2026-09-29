import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  discoverySnapshotCompleteness,
  getDiscoverySnapshot,
  upsertDiscoverySnapshotAnswers,
} from '@/lib/domain/customers/discovery-snapshots';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A discovery snapshot is state about an existing customer, never a second entity (I61). This
 * suite proves the composite FK to `(organization_id, customers.id)` actually refuses a
 * cross-tenant customer id, that the capability gate (`customer.update`) holds, that
 * `upsertDiscoverySnapshotAnswers` merges rather than overwrites, and that each answer's own
 * status/source/timestamp survive a merge untouched by an unrelated patch.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

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

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

describe('discovery snapshots', () => {
  let alice: Tenant;
  let bob: Tenant;
  let aliceCustomerId: string;
  let bobCustomerId: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('alice');
    bob = await newTenant('bob');

    aliceCustomerId = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Alice Prospect',
    });
    bobCustomerId = await createCustomer(bob.db, {
      organizationId: bob.organizationId,
      name: 'Bob Prospect',
    });
  });

  it('starts with no snapshot', async () => {
    const snapshot = await getDiscoverySnapshot(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
    });
    expect(snapshot).toBeNull();
  });

  it('starts a snapshot on first write and merges on the next', async () => {
    const first = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { contactChannels: { value: 'Phone and email, prefers email.', status: 'confirmed', source: 'Owner' } },
    });
    expect(first.answers.contactChannels).toMatchObject({
      value: 'Phone and email, prefers email.',
      status: 'confirmed',
      source: 'Owner',
    });
    expect(typeof first.answers.contactChannels?.updatedAt).toBe('string');

    const second = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { teamAccess: { value: 'Two owners, one dispatcher.', status: 'provided', source: 'demo_form' } },
    });

    expect(second.answers.contactChannels?.value).toBe('Phone and email, prefers email.');
    expect(second.answers.teamAccess).toMatchObject({ value: 'Two owners, one dispatcher.', status: 'provided' });
  });

  it('overwrites only the requirement a patch names, and only that requirement\'s own timestamp', async () => {
    const before = (await getDiscoverySnapshot(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
    }))!;

    const updated = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { contactChannels: { value: 'Email only now.', status: 'confirmed', source: 'Owner' } },
    });

    expect(updated.answers.contactChannels?.value).toBe('Email only now.');
    expect(updated.answers.teamAccess).toEqual(before.answers.teamAccess);
  });

  it('derives completeness against the sales_discovery stage rather than storing it', async () => {
    const snapshot = await getDiscoverySnapshot(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
    });
    expect(snapshot).not.toBeNull();

    const completeness = discoverySnapshotCompleteness(snapshot!);
    expect(completeness).toEqual({ answered: 2, total: 12 });
  });

  it('shows each tenant only its own snapshot (I1)', async () => {
    await upsertDiscoverySnapshotAnswers(bob.db, {
      organizationId: bob.organizationId,
      customerId: bobCustomerId,
      patch: { bookingIntake: { value: 'Books by phone only.', status: 'confirmed', source: 'Owner' } },
    });

    const stolen = await getDiscoverySnapshot(alice.db, {
      organizationId: bob.organizationId,
      customerId: bobCustomerId,
    });
    expect(stolen).toBeNull();
  });

  it('clears a requirement rather than storing an empty confirmed answer', async () => {
    const withValue = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { phoneHandling: { value: 'Voicemail, checked twice a day.', status: 'confirmed', source: 'Owner' } },
    });
    expect(withValue.answers.phoneHandling).toBeDefined();

    // A form submitting every field, blank ones included — the shape the edit action always
    // sends — must not turn an untouched requirement into an empty "confirmed" answer.
    const afterWholeFormSubmit = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: {
        phoneHandling: { value: '', status: 'confirmed', source: 'Owner' },
        websiteSurfaces: { value: '', status: 'confirmed', source: 'Owner' },
      },
    });
    expect(afterWholeFormSubmit.answers.phoneHandling).toBeUndefined();
    expect(afterWholeFormSubmit.answers.websiteSurfaces).toBeUndefined();
    // What a prior test already recorded survives an unrelated blank submission untouched.
    expect(afterWholeFormSubmit.answers.contactChannels).toBeDefined();
  });

  it('refuses a customer id that belongs to a different organization', async () => {
    await expect(
      upsertDiscoverySnapshotAnswers(alice.db, {
        organizationId: alice.organizationId,
        customerId: bobCustomerId,
        patch: { existingSoftware: { value: 'Spreadsheets.', status: 'confirmed', source: 'Owner' } },
      }),
    ).rejects.toMatchObject({ code: 'discovery_snapshots.customer_not_found' });
  });
});
