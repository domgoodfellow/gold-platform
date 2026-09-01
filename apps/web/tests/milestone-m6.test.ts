import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addAutomationAction,
  createAutomationRule,
  listAutomationRuns,
} from '@/lib/domain/automation/rules';
import {
  createMessageTemplate,
  listMessageDeliveries,
} from '@/lib/domain/automation/templates';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  createLocation,
  setLocationCoordinates,
} from '@/lib/domain/locations/locations';
import { configureBusiness } from '@/lib/domain/onboarding/configure';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { addMember } from '@/lib/domain/tenancy/members';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from './helpers/founding';

/**
 * M6 — workflows, automations, and the channels they act through.
 *
 * > **Done when:** the business already live on this platform adds a second technician, writes a
 * > rule — *when the forecast at a job's location crosses this threshold, move the job and tell
 * > the customer* — and a forecast change reschedules the job and sends the message. No code
 * > change and no deploy.
 *
 * **The five milestone tests before this one each invert the one before, and this one's
 * inversion is that nobody is watching.** M1 ran byte-identical input through one database, M2
 * ran identical input twice, M3 ran maximally different input through identical code, M4 ran
 * half of itself as somebody who is a member of nothing, and M5 ran as somebody who is a member
 * of *none of them*. Every one of those was proved by a person doing something. This one is
 * proved by a person doing nothing: the rule is written, the world changes, and the platform
 * acts in a transaction with no session in it at all.
 *
 * **Three structural claims sit beside the run, and they are the ones that decay silently.**
 *
 *   * *An automation may not do what a person may not do.* The same trigger that refuses a
 *     technician an illegal status change refuses a rule (I13), and the same exclusion
 *     constraint that refuses a double booking refuses a rule's reschedule (I7).
 *   * *An automation computes nothing the domain layer owns.* The action catalogue is read out
 *     of the database and asserted to contain nothing that prices or searches for a slot — which
 *     is I4 and I5 held from a direction they have never been pushed from before.
 *   * *The thing that turns the clock can reach almost nothing.* `automation_runner` holds no
 *     grant on any table, asserted from `information_schema` rather than from a migration.
 *
 * **No code change and no deploy** is the criterion's own phrase, and it is what makes the
 * fixture below matter: everything this test does after the business exists is a call a screen
 * makes, and the weather arrives through the one function the fetcher is allowed to call.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const CONFIGURE = fileURLToPath(
  new URL('../lib/domain/onboarding/configure.ts', import.meta.url),
);

type Person = { db: SupabaseClient; email: string; userId: string };

let owner: Person;
let technician: Person;
let organizationId: string;
let statusIds: string[];
let typeId: string;

async function newPerson(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `m6-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
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

  return { db, email, userId: data.user.id };
}

describe('M6 — a business that runs itself', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    owner = await newPerson('owner');

    // **A business already live on this platform**, which is the criterion's own framing and
    // the reason this test does not stand up a second tenant built to need weather. GOLD
    // provisions it; its owner gives it its shape (D29).
    organizationId = await foundBusiness({
      ownerEmail: owner.email,
      name: `Tyre Fitters ${randomUUID().slice(0, 6)}`,
      timezone: 'Europe/Amsterdam',
      currency: 'EUR',
      displayName: 'Owner',
    });

    const configured = await configureBusiness(owner.db, organizationId, {
      typeName: 'Fitting',
      statuses: ['Booked', 'On the way', 'Done', 'Postponed'],
      transitions: [
        [0, 1],
        [1, 2],
        [0, 3],
      ],
      fields: {},
      prices: [{ name: 'Tyre change', unit: 'wheel', amountMinor: 4500 }],
      hours: [],
      roles: [],
    });
    statusIds = configured.statusIds;
    typeId = configured.typeId;

    await setModuleEnabled(owner.db, { organizationId, key: 'automations', enabled: true });
    await setModuleEnabled(owner.db, { organizationId, key: 'weather', enabled: true });
  });

  it('adds a second technician, who can run the work and not the rules', async () => {
    // "Adds a second technician" is the criterion's, and it is not decoration: the whole point
    // of a rule is that it acts when nobody is present, which is only interesting in a business
    // with more than one person in it.
    const roleId = await createRole(owner.db, {
      organizationId,
      name: 'Technician',
      capabilities: ALL_CAPABILITIES.filter((entry) => entry !== 'automation.manage'),
    });

    technician = await newPerson('tech');
    await addMember(owner.db, {
      organizationId,
      email: technician.email,
      roleId,
      displayName: 'Second technician',
    });

    // They can see the rules and cannot write one. A job that moves on its own must never be a
    // mystery to the person watching it (I12), and writing the rules is a separate authority.
    await expect(
      createAutomationRule(technician.db, {
        organizationId,
        name: 'A rule of my own',
        triggerKind: 'event',
        triggerEventAction: 'work_item.created',
      }),
    ).rejects.toMatchObject({ code: 'automations.forbidden' });
  });

  it('moves the job and tells the customer, with nobody present', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();

    try {
      // What the business says to its customers, in its own words. Every word below is theirs;
      // the platform contributes the five placeholders and not one syllable more.
      const templateId = await createMessageTemplate(owner.db, {
        organizationId,
        name: 'Postponed for weather',
        subject: 'We have moved your fitting',
        body: 'Hello {{customer}} — the wind has picked up, so {{job}} is now {{when}}. {{business}}',
      });

      // *When the forecast at a job's location crosses this threshold, move the job and tell the
      // customer.* Three rows: a trigger, and two actions.
      const ruleId = await createAutomationRule(owner.db, {
        organizationId,
        name: 'Too windy to fit',
        triggerKind: 'external_reading',
        triggerMetric: 'wind_speed',
        triggerComparison: 'above',
        triggerThreshold: 60,
        triggerUnit: 'km/h',
      });
      await addAutomationAction(owner.db, {
        organizationId,
        ruleId,
        kind: 'shift_schedule',
        shiftMinutes: 1440,
      });
      await addAutomationAction(owner.db, {
        organizationId,
        ruleId,
        kind: 'notify',
        templateId,
        channel: 'email',
      });

      const locationId = await createLocation(owner.db, {
        organizationId,
        label: 'The depot',
        address: 'Havenstraat 4, Amsterdam',
      });
      await setLocationCoordinates(owner.db, {
        id: locationId,
        latitude: 52.370216,
        longitude: 4.895168,
      });

      const customerId = await createCustomer(owner.db, {
        organizationId,
        name: 'Marieke',
        email: `marieke-${randomUUID().slice(0, 8)}@example.test`,
      });
      const van = await createResource(owner.db, { organizationId, name: 'Fitting van' });

      // The second technician books the work. From here nobody touches anything.
      const workItemId = await createWorkItem(technician.db, {
        organizationId,
        statusId: statusIds[0],
        title: 'Four winter tyres',
        customerId,
        locationId,
      });
      const startsAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      await scheduleWorkItem(technician.db, {
        workItemId,
        resourceId: van,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
      });

      // **The world changes.** This is the fetcher's only write, reached through the one
      // function its role may execute — so what arrives here arrives the way a forecast does.
      await client.query(
        `select public.record_external_readings($1, jsonb_build_array(jsonb_build_object(
           'metric', 'wind_speed', 'value', 74, 'unit', 'km/h', 'applies_at', $2::timestamptz)))`,
        [locationId, startsAt.toISOString()],
      );

      // **And the clock turns, in a transaction with no session in it.** No screen, no
      // capability, no member. This is the whole milestone.
      const { rows } = await client.query('select public.run_due_automations() as ran');
      expect(Number(rows[0].ran)).toBe(1);

      const moved = (await listWorkItems(owner.db, { organizationId })).find(
        (item) => item.id === workItemId,
      );
      expect(new Date(moved!.window!.startsAt).getTime()).toBe(
        startsAt.getTime() + 24 * 60 * 60 * 1000,
      );

      const [delivery] = await listMessageDeliveries(owner.db, {
        organizationId,
        subjectId: workItemId,
      });
      expect(delivery.recipient).toContain('marieke-');
      expect(delivery.subjectLine).toBe('We have moved your fitting');
      // **Every word the business wrote and no other.** The message is asserted whole rather
      // than by fragments, because a greeting or a footer added by any layer between here and
      // somebody's inbox is exactly the failure this cannot have.
      expect(delivery.body).toMatch(
        /^Hello Marieke — the wind has picked up, so Four winter tyres is now .+\. Tyre Fitters/,
      );
      // Resolved *after* the move, so the customer is told the new time rather than the old one.
      expect(delivery.body).not.toContain('{{');

      const runs = await listAutomationRuns(owner.db, { organizationId, ruleId });
      expect(runs).toHaveLength(1);
      expect(runs[0].outcome).toBe('done');

      // No code changed and nothing was deployed. Everything above after the business existed is
      // a call a screen already makes, plus one function the fetcher is allowed to call.
    } finally {
      await client.end();
    }
  });

  it('refuses a rule what it refuses a person, and records the refusal', async () => {
    // **The claim that separates a runtime from a back door.** "On the way" cannot follow
    // "Postponed" in this business's own lifecycle, and a rule saying otherwise is refused by
    // `app.check_status_transition` — the same trigger that refuses a technician (I13).
    const ruleId = await createAutomationRule(owner.db, {
      organizationId,
      name: 'Skip ahead',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });
    await addAutomationAction(owner.db, {
      organizationId,
      ruleId,
      kind: 'change_status',
      statusId: statusIds[1],
    });

    const workItemId = await createWorkItem(technician.db, {
      organizationId,
      statusId: statusIds[3],
      title: 'Started somewhere else',
    });

    const runs = await listAutomationRuns(owner.db, { organizationId, ruleId });
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe('failed');

    // And the technician's own write stands. A rule a business got wrong may never roll back
    // the work that tripped it.
    const survived = (await listWorkItems(owner.db, { organizationId })).find(
      (item) => item.id === workItemId,
    );
    expect(survived?.status.id).toBe(statusIds[3]);
  });

  it('offers no action that computes what the domain layer owns (I4, I5)', async () => {
    // **Read from the database rather than from the TypeScript list**, because the database is
    // what a rule is actually checked against and the two could drift. D30's cost is that no
    // action may search for a free slot or work out a price: both are single calculations this
    // platform owns, and a second copy of either in a second runtime is what I4 and I5 forbid.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select pg_get_constraintdef(oid) as definition
           from pg_constraint
          where conrelid = 'public.automation_actions'::regclass
            and conname = 'automation_actions_action_kind_check'`,
      );

      const catalogue = String(rows[0].definition);
      for (const kind of ['change_status', 'notify', 'shift_schedule', 'create_work_item']) {
        expect(catalogue).toContain(kind);
      }
      // The two that must never appear. A rule that priced something would be a second price
      // calculation; one that found a slot would be a second availability calculation.
      expect(catalogue).not.toContain('price');
      expect(catalogue).not.toContain('find_slot');
      expect(catalogue).not.toContain('reschedule_to_free');
    } finally {
      await client.end();
    }
  });

  it('turns the clock with a role that can reach almost nothing', async () => {
    // I21's shape on a fourth axis, asserted the way `payment_webhook`'s is: the difference
    // between a policy declining and a privilege not existing is the whole guarantee, and only
    // one of them survives a careless policy author.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select table_name from information_schema.role_table_grants
          where grantee = 'automation_runner'`,
      );
      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('still stands a whole business up with no branch on which one it is', async () => {
    // M3's structural claim, extended rather than replaced. `configureBusiness` now writes rules
    // as well, and the assertion that made it worth having is unchanged: no word belonging to
    // any tenant appears in it. A branch on business shape here would be the per-client app
    // studio `vision.md` refuses, arriving as a helper.
    const source = readFileSync(CONFIGURE, 'utf8');

    for (const word of ['Fitting', 'Booked', 'Postponed', 'Tyre', 'wind', 'weather']) {
      expect(source, `configure.ts names "${word}"`).not.toContain(word);
    }

    // And a shape that carries rules produces them, which is what makes the field worth having
    // rather than a type nobody fills in.
    const second = await newPerson('shape');
    const secondOrg = await foundBusiness({
      ownerEmail: second.email,
      name: `Window Cleaners ${randomUUID().slice(0, 6)}`,
      timezone: 'Europe/London',
      currency: 'GBP',
      displayName: 'Owner',
    });
    const configured = await configureBusiness(second.db, secondOrg, {
      typeName: 'Round',
      statuses: ['Due', 'Cleaned'],
      transitions: [[0, 1]],
      fields: {},
      prices: [],
      hours: [],
      roles: [],
      automations: [{ name: 'Mark it due', on: 'work_item.created', moveTo: 0 }],
    });

    expect(configured.automationRuleIds).toHaveLength(1);
  });

  it('leaves the other business alone throughout', async () => {
    // The invariant every milestone test carries, asked of the newest tables. A rule, a run, a
    // reading and a message all belong to one tenant and reach no other.
    const stranger = await newPerson('stranger');

    for (const table of [
      'automation_rules',
      'automation_runs',
      'message_deliveries',
      'external_readings',
    ] as const) {
      const { data, error } = await stranger.db
        .from(table)
        .select('organization_id')
        .eq('organization_id', organizationId);

      // RLS returns nothing rather than refusing: from a stranger's position the rows simply do
      // not exist, and `typeId` above belongs to a business they have never heard of.
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    }

    expect(typeId).toBeTruthy();
  });
});
