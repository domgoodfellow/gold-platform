import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createFieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createResource } from '@/lib/domain/resources/resources';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { type Capability } from '@/lib/domain/tenancy/capabilities';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import {
  changeWorkItemStatus,
  createWorkItemTransition,
} from '@/lib/domain/work-items/transitions';
import { createWorkItemStatus, updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems, updateWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from './helpers/founding';

/**
 * Correcting a job, and making cancellation free the van.
 *
 * Two halves that arrived together because scoping the first found the second.
 *
 * **Editing** is the unremarkable half: a job typed wrong today was wrong permanently, and
 * `work_item.update` is a third lane in the per-column split that `work_item.transition` and
 * `work_item.schedule` already established. What is worth asserting is the *shape* of that
 * split — that the new capability reaches the title and reaches nothing else, from any path.
 *
 * **Cancellation is the half `roadmap.md` was wrong about.** It said cancelling "is a status
 * the tenant configures and a transition into it, needing no new code". The exclusion
 * constraint disagreed: its partial predicate was `resource_id is not null and
 * scheduled_during is not null`, which knows nothing about status, so a cancelled job went on
 * holding its van forever. The fix is a question the tenant answers about their own word —
 * `releases_resource` — and the assertions below are that the constraint and `listSchedule`
 * both now believe the answer. That agreement *is* I5: what keeps one availability
 * calculation honest is that it and the constraint say the same thing.
 *
 * It is deliberately not `is_terminal`. That flag would be the platform deciding what a
 * status means; this asks whether the van is still occupied, which is a fact about the
 * business's own operations that only the business can supply (D6).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const MORNING = { startsAt: '2026-10-06T09:00:00.000Z', endsAt: '2026-10-06T11:00:00.000Z' };

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  typeId: string;
  bookedId: string;
  cancelledId: string;
  resourceId: string;
  customerId: string;
  workItemId: string;
};

let acme: Tenant;

async function signUp(
  label: string,
): Promise<{ db: SupabaseClient; userId: string; email: string }> {
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

  return { db, userId: created.user.id, email };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, userId, email } = await signUp(label);

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'America/Toronto',
    currency: 'CAD',
  });

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Callout' });
  const bookedId = await createWorkItemStatus(db, {
    organizationId: orgId,
    typeId,
    name: 'Booked',
  });
  const cancelledId = await createWorkItemStatus(db, {
    organizationId: orgId,
    typeId,
    name: 'Cancelled',
  });

  // The lifecycle has to be wired, because a type with no configured transitions is frozen
  // rather than unconstrained (I13).
  await createWorkItemTransition(db, {
    organizationId: orgId,
    typeId,
    fromStatusId: bookedId,
    toStatusId: cancelledId,
  });

  const resourceId = await createResource(db, { organizationId: orgId, name: 'Van 1' });
  const customerId = await createCustomer(db, { organizationId: orgId, name: 'Rue Sainte-Anne' });

  const workItemId = await createWorkItem(db, {
    organizationId: orgId,
    title: 'Tyre swap — wrong car',
    statusId: bookedId,
  });

  await scheduleWorkItem(db, { workItemId, resourceId, ...MORNING });

  return {
    db,
    userId,
    organizationId: orgId,
    typeId,
    bookedId,
    cancelledId,
    resourceId,
    customerId,
    workItemId,
  };
}

/** A second member of the same tenant, holding exactly the capabilities named. */
async function member(tenant: Tenant, label: string, capabilities: Capability[]) {
  const { db, userId, email } = await signUp(label);

  const roleId = await createRole(tenant.db, {
    organizationId: tenant.organizationId,
    name: label,
    capabilities,
  });
  await addMember(tenant.db, {
    organizationId: tenant.organizationId,
    email,
    displayName: label,
    roleId,
  });

  return { db, userId };
}

async function readItem(tenant: Tenant) {
  const items = await listWorkItems(tenant.db, { organizationId: tenant.organizationId });
  return items.find((item) => item.id === tenant.workItemId)!;
}

describe('correcting a job, and cancelling one', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    acme = await newTenant('wie-acme');
  });

  it('corrects a title and attaches a customer', async () => {
    await updateWorkItem(acme.db, {
      organizationId: acme.organizationId,
      id: acme.workItemId,
      title: 'Tyre swap — Peugeot 208',
      customerId: acme.customerId,
    });

    const item = await readItem(acme);
    expect(item.title).toBe('Tyre swap — Peugeot 208');
    expect(item.customer?.id).toBe(acme.customerId);
  });

  it('detaches a reference, because clearing one is an edit', async () => {
    await updateWorkItem(acme.db, {
      organizationId: acme.organizationId,
      id: acme.workItemId,
      title: 'Tyre swap — Peugeot 208',
      customerId: null,
    });

    expect((await readItem(acme)).customer).toBeNull();

    // Put it back; later assertions read this job.
    await updateWorkItem(acme.db, {
      organizationId: acme.organizationId,
      id: acme.workItemId,
      title: 'Tyre swap — Peugeot 208',
      customerId: acme.customerId,
    });
  });

  it('leaves the schedule alone: editing details is not scheduling', async () => {
    const before = await readItem(acme);

    await updateWorkItem(acme.db, {
      organizationId: acme.organizationId,
      id: acme.workItemId,
      title: 'Tyre swap — Peugeot 208 (front)',
      customerId: acme.customerId,
    });

    const after = await readItem(acme);
    expect(after.window).toEqual(before.window);
    expect(after.resource?.id).toBe(acme.resourceId);
    expect(after.status.id).toBe(acme.bookedId);
  });

  it('will not change a work item type, even as a raw update', async () => {
    // `type_id` is outside the column grant entirely. Changing it would strand the status
    // the job sits in, and I20's three-column reference is what would refuse it — better to
    // have no path at all than one that fails halfway with a foreign key error.
    const otherType = await createWorkItemType(acme.db, {
      organizationId: acme.organizationId,
      name: 'Installation',
    });

    const { error } = await acme.db
      .from('work_items')
      .update({ type_id: otherType })
      .eq('id', acme.workItemId);

    expect(error).not.toBeNull();
    expect((await readItem(acme)).type.id).toBe(acme.typeId);
  });

  it('holds work_item.update apart from transition and schedule', async () => {
    const editor = await member(acme, 'wie-editor', ['work_item.update']);

    // The lane they hold works.
    await expect(
      updateWorkItem(editor.db, {
        organizationId: acme.organizationId,
        id: acme.workItemId,
        title: 'Edited by someone who may only edit',
        customerId: acme.customerId,
      }),
    ).resolves.toBeUndefined();

    // The two they do not hold are refused by the trigger, not by the form.
    await expect(
      changeWorkItemStatus(editor.db, {
        workItemId: acme.workItemId,
        toStatusId: acme.cancelledId,
      }),
    ).rejects.toMatchObject({ code: 'work_items.transition_forbidden' });

    await expect(
      scheduleWorkItem(editor.db, {
        workItemId: acme.workItemId,
        resourceId: acme.resourceId,
        startsAt: '2026-10-07T09:00:00.000Z',
        endsAt: '2026-10-07T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'scheduling.forbidden' });

    // And the raw path is refused identically — the capability lives in the database (I12).
    const { error } = await editor.db
      .from('work_items')
      .update({ status_id: acme.cancelledId })
      .eq('id', acme.workItemId);
    expect(error).not.toBeNull();
  });

  it('refuses to edit at all without the capability', async () => {
    const watcher = await member(acme, 'wie-watcher', ['work_item.schedule']);

    await expect(
      updateWorkItem(watcher.db, {
        organizationId: acme.organizationId,
        id: acme.workItemId,
        title: 'Should not stick',
        customerId: acme.customerId,
      }),
    ).rejects.toMatchObject({ code: 'work_items.forbidden' });

    expect((await readItem(acme)).title).toBe('Edited by someone who may only edit');
  });

  it('re-checks the field registry on an edit (I17)', async () => {
    await createFieldDefinition(acme.db, {
      organizationId: acme.organizationId,
      entityType: 'work_item',
      key: 'plate',
      label: 'Plate',
      kind: 'text',
      required: false,
    });

    await updateWorkItem(acme.db, {
      organizationId: acme.organizationId,
      id: acme.workItemId,
      title: 'Edited by someone who may only edit',
      customerId: acme.customerId,
      custom: { plate: 'ABC 123' },
    });

    expect((await readItem(acme)).custom).toMatchObject({ plate: 'ABC 123' });

    // An undeclared key is refused on the edit path exactly as on the create path.
    await expect(
      updateWorkItem(acme.db, {
        organizationId: acme.organizationId,
        id: acme.workItemId,
        title: 'Edited by someone who may only edit',
        customerId: acme.customerId,
        custom: { plate: 'ABC 123', invented: 'nope' },
      }),
    ).rejects.toMatchObject({ code: 'fields.unknown' });
  });

  it('writes the edit to the timeline, attributed (I11)', async () => {
    const { data, error } = await acme.db
      .from('events')
      .select('action, actor_id, entity_id')
      .eq('organization_id', acme.organizationId)
      .eq('action', 'work_item.updated');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((event) => event.entity_id === acme.workItemId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  it('still holds the resource when a status says nothing', async () => {
    // The state before the tenant answers the question: "Cancelled" is just a word, and a
    // job in it goes on occupying the van. This is what `roadmap.md` assumed was already
    // enough, and asserting it here is what makes the next test mean something.
    await changeWorkItemStatus(acme.db, {
      workItemId: acme.workItemId,
      toStatusId: acme.cancelledId,
    });

    const [van] = await listSchedule(acme.db, {
      organizationId: acme.organizationId,
      within: MORNING,
    });
    expect(van.booked.map((entry) => entry.workItemId)).toContain(acme.workItemId);

    // And nothing else can take the slot.
    const other = await createWorkItem(acme.db, {
      organizationId: acme.organizationId,
      title: 'Someone else’s morning',
      statusId: acme.bookedId,
    });
    await expect(
      scheduleWorkItem(acme.db, { workItemId: other, resourceId: acme.resourceId, ...MORNING }),
    ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
  });

  it('frees the resource once the tenant says that status releases it', async () => {
    await updateWorkItemStatus(acme.db, {
      id: acme.cancelledId,
      name: 'Cancelled',
      position: 1,
      releasesResource: true,
      marksComplete: false,
    });

    // The availability calculation now agrees (I5) — the cancelled job is no longer busy.
    const [van] = await listSchedule(acme.db, {
      organizationId: acme.organizationId,
      within: MORNING,
    });
    expect(van.booked.map((entry) => entry.workItemId)).not.toContain(acme.workItemId);
    expect(van.free).toEqual([MORNING]);

    // …and so does the constraint, which is the half that matters. A window `freeWindows`
    // calls free must be committable, or I5 is a second opinion rather than the only one.
    const replacement = await createWorkItem(acme.db, {
      organizationId: acme.organizationId,
      title: 'The job that took the slot',
      statusId: acme.bookedId,
    });
    await expect(
      scheduleWorkItem(acme.db, {
        workItemId: replacement,
        resourceId: acme.resourceId,
        ...MORNING,
      }),
    ).resolves.toBeUndefined();
  });

  it('reaches work already in that status, because it is a cache and not a snapshot', async () => {
    // The cancelled job was cancelled *before* the tenant answered the question, and it was
    // freed anyway. A snapshot would have freed only the next cancellation and left this
    // van booked — which is why this one column is deliberately not I8's shape.
    const { data, error } = await acme.db
      .from('work_items')
      .select('status_releases_resource')
      .eq('id', acme.workItemId)
      .single();

    expect(error).toBeNull();
    expect(data!.status_releases_resource).toBe(true);
  });

  it('refuses to un-release a status when that would double-book (I7)', async () => {
    // Two jobs now overlap on Van 1: the cancelled one and its replacement. Telling the
    // platform that "Cancelled" holds a resource after all is refusing to be representable,
    // and the exclusion constraint says so rather than letting the board lie.
    await expect(
      updateWorkItemStatus(acme.db, {
        id: acme.cancelledId,
        name: 'Cancelled',
        position: 1,
        releasesResource: false,
      marksComplete: false,
      }),
    ).rejects.toMatchObject({ code: 'statuses.release_conflict' });
  });

  it('never lets a caller assert the mirror directly', async () => {
    // `status_releases_resource` is the platform's answer to its own constraint, not a fact
    // anybody may state. It is outside every column grant **for update**.
    const { error } = await acme.db
      .from('work_items')
      .update({ status_releases_resource: false })
      .eq('id', acme.workItemId);

    expect(error).not.toBeNull();
  });

  it('never lets a caller assert the mirror at creation either', async () => {
    // **The insert side of the same claim, and until `20260902000003` it was not true.**
    // `work_items` carried a table-wide insert grant from `20260827000003`, so this column —
    // added two migrations later — inherited one, and the sentence "it is in no column grant"
    // was true of update and false of insert. Nothing was exploitable, because
    // `work_items_mirror_status_release` fires `before insert` and overwrote whatever arrived;
    // what was wrong was that the guarantee rested on a trigger while the documents claimed it
    // rested on a privilege. Now it rests on both.
    const { error } = await acme.db.from('work_items').insert({
      organization_id: acme.organizationId,
      type_id: acme.typeId,
      status_id: acme.bookedId,
      title: 'Claims to release the van',
      created_by: acme.userId,
      status_releases_resource: true,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('refuses to schedule at creation without work_item.schedule', async () => {
    // **The capability split has to hold at insert as well as at update.**
    // `app.check_work_item_update_capability` is a `before update` trigger, so the only thing
    // standing between a caller and a scheduled job at creation is the insert policy — and that
    // asks for `work_item.create` alone. `scheduled_during` and `resource_id` are both in the
    // table-wide insert grant, so a clerk who may raise jobs but not put them in the diary could
    // raise one already in it, occupying a resource nobody let them book.
    //
    // The domain layer never does this — `createWorkItem` takes no schedule — which is why it
    // survived: the shape of the one caller was doing the work a policy should. I12 says a
    // direct call must be refused exactly as a form is.
    const clerk = await member(acme, 'wie-clerk', ['work_item.create']);

    const { error } = await clerk.db.from('work_items').insert({
      organization_id: acme.organizationId,
      type_id: acme.typeId,
      status_id: acme.bookedId,
      title: 'Raised straight into the diary',
      created_by: clerk.userId,
      resource_id: acme.resourceId,
      scheduled_during: '["2026-10-09T09:00:00+00","2026-10-09T10:00:00+00")',
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');

    // And the same person may still do the half they hold, so what is refused is plainly the
    // scheduling rather than the creating.
    const { error: plain } = await clerk.db.from('work_items').insert({
      organization_id: acme.organizationId,
      type_id: acme.typeId,
      status_id: acme.bookedId,
      title: 'Raised, and left for a dispatcher',
      created_by: clerk.userId,
    });
    expect(plain).toBeNull();
  });
});
