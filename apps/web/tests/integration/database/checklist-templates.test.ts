import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import {
  addTypeChecklistItem,
  listChecklistItems,
  listTypeChecklistItems,
  removeTypeChecklistItem,
  setChecklistItemDone,
} from '@/lib/domain/work-items/checklists';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Checklist templates, and the reason they are a **copy** rather than a reference.
 *
 * `20260827000010_checklists.sql` deferred this and named the question it could not answer
 * without guessing: what happens to work already created when a template changes. The answer
 * is nothing, and it is the preserved-history rule — "editing today's configuration never changes yesterday's
 * committed work."
 *
 * A join would have meant that editing a template silently rewrote what a technician had
 * already agreed to do, and that removing a step unticked one they had already ticked. Both
 * are asserted below against a job created before the change, because a copy that is only
 * *described* as a copy is a join waiting to be written by somebody optimising a query.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  typeId: string;
  statusId: string;
};

let alice: Tenant;
let bob: Tenant;

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
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: orgId, name: 'Boiler service' });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    typeId,
    statusId: await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' }),
  };
}

async function newJob(tenant: Tenant, title: string): Promise<string> {
  return createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    title,
    statusId: tenant.statusId,
  });
}

describe('checklist templates', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('ct-alice');
    bob = await newTenant('ct-bob');
  });

  it('starts a type with no template at all', async () => {
    expect(
      await listTypeChecklistItems(alice.db, {
        organizationId: alice.organizationId,
        typeId: alice.typeId,
      }),
    ).toEqual([]);

    // And a job created before any template exists has an empty checklist, rather than one
    // the platform invented.
    const bare = await newJob(alice, 'Before any template');
    expect(
      await listChecklistItems(alice.db, {
        organizationId: alice.organizationId,
        workItemId: bare,
      }),
    ).toEqual([]);
  });

  it('copies the template onto a new work item, in order', async () => {
    await addTypeChecklistItem(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
      label: 'Isolate the supply',
    });
    await addTypeChecklistItem(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
      label: 'Photograph the meter',
    });

    const job = await newJob(alice, 'First job with a template');
    const steps = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });

    expect(steps.map((step) => step.label)).toEqual([
      'Isolate the supply',
      'Photograph the meter',
    ]);
    // Copies, not the template rows.
    const template = await listTypeChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    expect(steps.map((step) => step.id)).not.toEqual(template.map((item) => item.id));
    expect(steps.every((step) => step.doneAt === null)).toBe(true);
  });

  it('does not reach a job that already exists when the template gains a step', async () => {
    const job = await newJob(alice, 'Created before the third step');

    await addTypeChecklistItem(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
      label: 'Bleed the radiators',
    });

    const steps = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    expect(steps.map((step) => step.label)).toEqual([
      'Isolate the supply',
      'Photograph the meter',
    ]);

    // And the next job does get it, so the template is genuinely live for new work.
    const later = await newJob(alice, 'Created after');
    const laterSteps = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: later,
    });
    expect(laterSteps.map((step) => step.label)).toContain('Bleed the radiators');
  });

  it('does not untick work when a template step is removed', async () => {
    const job = await newJob(alice, 'Half done already');
    const [first] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    await setChecklistItemDone(alice.db, { checklistItemId: first.id, done: true });

    const template = await listTypeChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    const removed = template.find((item) => item.label === 'Isolate the supply')!;
    await removeTypeChecklistItem(alice.db, { id: removed.id });

    // The job still has the step, still ticked, still attributed. A join or a cascade would
    // have destroyed all three.
    const after = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    const survivor = after.find((step) => step.label === 'Isolate the supply');
    expect(survivor).toBeDefined();
    expect(survivor!.doneAt).not.toBeNull();
    expect(survivor!.doneBy).toBe(alice.userId);
  });

  it('records the copy on the timeline', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, payload')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'work_item.created');

    expect(error).toBeNull();
    // The first job predates the template and copied nothing; later ones copied steps.
    expect(data!.some((event) => (event.payload as { checklist_items: number }).checklist_items === 0)).toBe(true);
    expect(data!.some((event) => (event.payload as { checklist_items: number }).checklist_items > 0)).toBe(true);
  });

  it('cannot hang a template step off another tenant\'s type', async () => {
    await expect(
      addTypeChecklistItem(bob.db, {
        organizationId: bob.organizationId,
        typeId: alice.typeId,
        label: 'Borrowed',
      }),
    ).rejects.toMatchObject({ code: 'checklist_templates.type_not_found' });
  });

  it('shows each tenant only its own template', async () => {
    expect(
      await listTypeChecklistItems(bob.db, {
        organizationId: alice.organizationId,
        typeId: alice.typeId,
      }),
    ).toEqual([]);
  });

  it('refuses template changes to a member without the capability', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'Worker',
      capabilities: ['role.manage', 'work_item.create'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    // work_item.create is enough to add a step to a job, and deliberately not enough to
    // change what every future job of this kind involves.
    await expect(
      addTypeChecklistItem(bob.db, {
        organizationId: bob.organizationId,
        typeId: bob.typeId,
        label: 'Should not exist',
      }),
    ).rejects.toMatchObject({ code: 'checklist_templates.forbidden' });

    const direct = await bob.db.from('work_item_type_checklist_items').insert({
      organization_id: bob.organizationId,
      type_id: bob.typeId,
      label: 'Not this way either',
      created_by: bob.userId,
    });
    expect(direct.error?.code).toBe('42501');
  });
});
