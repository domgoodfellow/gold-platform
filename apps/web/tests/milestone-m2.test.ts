import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource, listResources } from '@/lib/domain/resources/resources';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { zonedDayRange } from '@/lib/domain/scheduling/window';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import {
  addChecklistItem,
  listChecklistItems,
  setChecklistItemDone,
} from '@/lib/domain/work-items/checklists';
import {
  listCosts,
  listTimeEntries,
  recordCost,
  recordTime,
} from '@/lib/domain/work-items/consumption';
import { createWorkItemStatus, listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import {
  allowedNextStatusIds,
  changeWorkItemStatus,
  createWorkItemTransition,
  listWorkItemTransitions,
} from '@/lib/domain/work-items/transitions';
import { createWorkItemType, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from './helpers/founding';

/**
 * THE M2 MILESTONE TEST.
 *
 * roadmap.md describes M2 as one demonstration, not a list of tables:
 *
 *   > an operator can define a work item type, its statuses, and its allowed transitions
 *   > from the admin UI without opening the database — and a work item moves through that
 *   > lifecycle, consuming a resource for a window that nothing else can double-book.
 *
 * Two properties of this file are what make it that demonstration rather than a summary of
 * the other test files.
 *
 * **Nothing here touches SQL.** Every call is a domain function — the same one the server
 * action behind the screen calls — and the only privileged client mints the two accounts,
 * exactly as `setup.ts` does everywhere. "Without opening the database" is a claim about the
 * path, so the path is what is exercised. Where a raw statement appears in the other M2
 * files it is there to prove a guarantee survives *without* the domain layer; here its
 * presence would quietly weaken the milestone's own claim.
 *
 * **The operator is not the founder.** A capability check exercised by the person who
 * granted it to themselves proves very little. The founder creates the business and a role,
 * and then a second human — who was handed that role — does every act the milestone names.
 *
 * And it is done twice, from byte-identical input: the same organization, type, status names,
 * transitions, technician, job title and — the sharp one — the same instants. Two businesses
 * booking the same technician's name for the same hour on the same Tuesday, and neither
 * blocking the other, is I7 and I2 together, and is the failure `constraints.md` quotes from
 * `tire-app-template` by name.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Deliberately identical across both businesses. Every one is a would-be collision. */
const RUN = randomUUID().slice(0, 8);
const SHARED = {
  organizationName: `Identical Operations Ltd ${RUN}`,
  timezone: 'Europe/Amsterdam',
  currency: 'EUR',
  operatorRole: 'Dispatcher',
  typeName: 'Callout',
  booked: 'Booked',
  onSite: 'On site',
  complete: 'Complete',
  resourceName: 'Sam Okafor',
  workItemTitle: 'Replace the pump',
  step: 'Photograph the meter',
  costDescription: 'Replacement valve',
  costMinor: 4250,
} as const;

/** The same Tuesday hour in both businesses. */
const DAY = '2026-09-01';
const NINE = '2026-09-01T09:00:00.000Z';
const TEN = '2026-09-01T10:00:00.000Z';
const HALF_PAST_NINE = '2026-09-01T09:30:00.000Z';
const ELEVEN = '2026-09-01T11:00:00.000Z';

/** Everything M2 says an operator must be able to do, and nothing else. */
const OPERATOR_CAPABILITIES = [
  'field.manage',
  'resource.create',
  'work_item.create',
  'work_item.transition',
  'work_item.schedule',
  'work_item.record',
] as const;

type Person = { db: SupabaseClient; userId: string; email: string };

type Business = {
  founder: Person;
  operator: Person;
  organizationId: string;
  typeId: string;
  booked: string;
  onSite: string;
  complete: string;
  resourceId: string;
  workItemId: string;
};

let a: Business;
let b: Business;

async function signUp(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { db, userId: created.user.id, email };
}

/**
 * Stand up one whole work engine, through the domain layer only.
 *
 * Read this as the script of a screen recording: found the business, hand somebody the
 * dispatcher role, and then everything else happens as that person.
 */
async function buildBusiness(label: string): Promise<Business> {
  const founder = await signUp(`${label}-founder`);
  const operator = await signUp(`${label}-operator`);

  const organizationId = await foundBusiness({ ownerEmail: founder.email,
    name: SHARED.organizationName,
    displayName: 'The Founder',
    timezone: SHARED.timezone,
    currency: SHARED.currency,
  });

  const roleId = await createRole(founder.db, {
    organizationId,
    name: SHARED.operatorRole,
    capabilities: [...OPERATOR_CAPABILITIES],
  });
  await addMember(founder.db, {
    organizationId,
    email: operator.email,
    displayName: 'Sam',
    roleId,
  });

  // From here on it is the operator, not the founder. Everything below is an admin screen.
  const db = operator.db;

  const typeId = await createWorkItemType(db, { organizationId, name: SHARED.typeName });

  const booked = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: SHARED.booked,
  });
  const onSite = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: SHARED.onSite,
  });
  const complete = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: SHARED.complete,
  });

  // The lifecycle: forward only, one step at a time. Booked → Complete is deliberately not
  // wired, so the test below has something that must be refused.
  await createWorkItemTransition(db, {
    organizationId,
    typeId,
    fromStatusId: booked,
    toStatusId: onSite,
  });
  await createWorkItemTransition(db, {
    organizationId,
    typeId,
    fromStatusId: onSite,
    toStatusId: complete,
  });

  const resourceId = await createResource(db, { organizationId, name: SHARED.resourceName });

  const workItemId = await createWorkItem(db, {
    organizationId,
    title: SHARED.workItemTitle,
    statusId: booked,
  });

  return {
    founder,
    operator,
    organizationId,
    typeId,
    booked,
    onSite,
    complete,
    resourceId,
    workItemId,
  };
}

describe('M2 — the work engine', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    a = await buildBusiness('m2-a');
    b = await buildBusiness('m2-b');
  });

  it('lets an operator define a type, its statuses and its transitions', async () => {
    // The first half of the criterion, asserted as what the operator can now see on screen.
    for (const business of [a, b]) {
      const db = business.operator.db;
      const organizationId = business.organizationId;

      const types = await listWorkItemTypes(db, { organizationId });
      expect(types.map((type) => type.name)).toEqual([SHARED.typeName]);

      const statuses = await listWorkItemStatuses(db, {
        organizationId,
        typeId: business.typeId,
      });
      expect(statuses.map((status) => status.name)).toEqual([
        SHARED.booked,
        SHARED.onSite,
        SHARED.complete,
      ]);

      const transitions = await listWorkItemTransitions(db, {
        organizationId,
        typeId: business.typeId,
      });
      expect(allowedNextStatusIds(transitions, business.booked)).toEqual([business.onSite]);
      expect(allowedNextStatusIds(transitions, business.onSite)).toEqual([business.complete]);
      expect(allowedNextStatusIds(transitions, business.complete)).toEqual([]);
    }
  });

  it('was configured by somebody who is not the founder', async () => {
    // The whole configuration exists, and the founder never performed any of it. A
    // capability granted and exercised by the same person proves nothing about the check.
    for (const business of [a, b]) {
      const { data, error } = await business.operator.db
        .from('events')
        .select('action, actor_id')
        .eq('organization_id', business.organizationId)
        .in('action', [
          'work_item_type.created',
          'work_item_status.created',
          'work_item_transition.created',
        ]);

      expect(error).toBeNull();
      expect(data!.length).toBe(6);
      expect(data!.every((event) => event.actor_id === business.operator.userId)).toBe(true);
      expect(data!.some((event) => event.actor_id === business.founder.userId)).toBe(false);
    }
  });

  it('moves a work item through that lifecycle, and only through it', async () => {
    const db = a.operator.db;

    // The jump the operator never wired. Refused before anything else is attempted, so a
    // later pass cannot be what makes it fail.
    await expect(
      changeWorkItemStatus(db, { workItemId: a.workItemId, toStatusId: a.complete }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });

    await changeWorkItemStatus(db, { workItemId: a.workItemId, toStatusId: a.onSite });
    await changeWorkItemStatus(db, { workItemId: a.workItemId, toStatusId: a.complete });

    const [item] = await listWorkItems(db, {
      organizationId: a.organizationId,
      typeId: a.typeId,
    });
    expect(item.status.label).toBe(SHARED.complete);

    // And the road back is not open either, because nothing wired it.
    await expect(
      changeWorkItemStatus(db, { workItemId: a.workItemId, toStatusId: a.onSite }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });
  });

  it('consumes a resource for a window that nothing else can double-book', async () => {
    const db = a.operator.db;

    await scheduleWorkItem(db, {
      workItemId: a.workItemId,
      resourceId: a.resourceId,
      startsAt: NINE,
      endsAt: TEN,
    });

    const second = await createWorkItem(db, {
      organizationId: a.organizationId,
      title: 'Somewhere else at the same time',
      statusId: a.booked,
    });

    await expect(
      scheduleWorkItem(db, {
        workItemId: second,
        resourceId: a.resourceId,
        startsAt: HALF_PAST_NINE,
        endsAt: ELEVEN,
      }),
    ).rejects.toMatchObject({ code: 'scheduling.double_booked' });

    // Back to back is not a clash, which is what half-open windows buy.
    await expect(
      scheduleWorkItem(db, {
        workItemId: second,
        resourceId: a.resourceId,
        startsAt: TEN,
        endsAt: ELEVEN,
      }),
    ).resolves.toBeUndefined();
  });

  it('lets the other business book the identical hour on an identically named technician', async () => {
    // The milestone's cross-tenant half, and the exact failure constraints.md quotes: with a
    // global exclusion constraint, or one that coalesced a null resource, business A's 9am
    // would block business B's.
    const db = b.operator.db;

    await scheduleWorkItem(db, {
      workItemId: b.workItemId,
      resourceId: b.resourceId,
      startsAt: NINE,
      endsAt: TEN,
    });

    const [item] = await listWorkItems(db, {
      organizationId: b.organizationId,
      typeId: b.typeId,
    });
    expect(item.window).toEqual({ startsAt: NINE, endsAt: TEN });
    expect(item.resource?.label).toBe(SHARED.resourceName);
  });

  it('shows each business a schedule built from its own rows only', async () => {
    const within = zonedDayRange(DAY, SHARED.timezone);

    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const schedule = await listSchedule(self.operator.db, {
        organizationId: self.organizationId,
        within,
      });

      // One technician, whose name is the same in both businesses and whose id is not.
      expect(schedule.map((entry) => entry.resource.name)).toEqual([SHARED.resourceName]);
      expect(schedule[0].resource.id).toBe(self.resourceId);
      expect(schedule[0].resource.id).not.toBe(other.resourceId);

      // The 9–10 booking is there, and the free time is what is left around it — asserted as
      // a value rather than as "not empty", so a schedule that lost its bookings would fail.
      expect(schedule[0].booked.map((entry) => entry.window.startsAt)).toContain(NINE);
      expect(
        schedule[0].free.some((window) => window.endsAt === NINE),
      ).toBe(true);

      // And holding the other business's real organization id yields nothing at all.
      expect(
        await listSchedule(self.operator.db, {
          organizationId: other.organizationId,
          within,
        }),
      ).toEqual([]);
    }
  });

  it('keeps every part of the lifecycle inside its own business', async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const db = self.operator.db;
      const organizationId = other.organizationId;

      // Knowing the other business's ids grants nothing: from here those rows do not exist.
      expect(await listWorkItemTypes(db, { organizationId })).toEqual([]);
      expect(
        await listWorkItemStatuses(db, { organizationId, typeId: other.typeId }),
      ).toEqual([]);
      expect(
        await listWorkItemTransitions(db, { organizationId, typeId: other.typeId }),
      ).toEqual([]);
      expect(await listWorkItems(db, { organizationId })).toEqual([]);
      expect(await listResources(db, { organizationId })).toEqual([]);

      // And the other business's work item cannot be moved or scheduled from here.
      await expect(
        changeWorkItemStatus(db, {
          workItemId: other.workItemId,
          toStatusId: other.onSite,
        }),
      ).rejects.toMatchObject({ code: 'work_items.transition_forbidden' });

      await expect(
        scheduleWorkItem(db, {
          workItemId: other.workItemId,
          resourceId: self.resourceId,
          startsAt: '2026-09-02T09:00:00.000Z',
          endsAt: '2026-09-02T10:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'scheduling.forbidden' });
    }
  });

  it('records what the job involved, what it took and what it cost', async () => {
    const db = a.operator.db;

    const stepId = await addChecklistItem(db, {
      workItemId: a.workItemId,
      label: SHARED.step,
    });
    await setChecklistItemDone(db, { checklistItemId: stepId, done: true });

    await recordTime(db, {
      workItemId: a.workItemId,
      resourceId: a.resourceId,
      // Longer than the hour it was booked for. The gap between planned and actual is the
      // reason both columns exist.
      startedAt: NINE,
      endedAt: ELEVEN,
    });

    await recordCost(db, {
      workItemId: a.workItemId,
      description: SHARED.costDescription,
      amountMinor: SHARED.costMinor,
    });

    const [step] = await listChecklistItems(db, {
      organizationId: a.organizationId,
      workItemId: a.workItemId,
    });
    expect(step.doneBy).toBe(a.operator.userId);

    const [time] = await listTimeEntries(db, {
      organizationId: a.organizationId,
      workItemId: a.workItemId,
    });
    expect(time.worked).toEqual({ startsAt: NINE, endsAt: ELEVEN });

    const [cost] = await listCosts(db, {
      organizationId: a.organizationId,
      workItemId: a.workItemId,
    });
    expect(cost.amountMinor).toBe(SHARED.costMinor);
    expect(cost.currency).toBe(SHARED.currency);
  });

  it('has the whole lifecycle on the timeline, attributed and tenant-scoped (I11)', async () => {
    const { data, error } = await a.operator.db
      .from('events')
      .select('action, actor_id, organization_id')
      .eq('organization_id', a.organizationId);

    expect(error).toBeNull();

    const actions = new Set(data!.map((event) => event.action));
    for (const action of [
      'work_item_type.created',
      'work_item_status.created',
      'work_item_transition.created',
      'work_item.created',
      'work_item.status_changed',
      'work_item.scheduled',
      'work_item.checklist_item_added',
      'work_item.checklist_item_checked',
      'work_item.time_recorded',
      'work_item.cost_recorded',
    ]) {
      expect(actions).toContain(action);
    }

    // Nothing of the other business's is anywhere in here.
    expect(data!.every((event) => event.organization_id === a.organizationId)).toBe(true);
  });
});
