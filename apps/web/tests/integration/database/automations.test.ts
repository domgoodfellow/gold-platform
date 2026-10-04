import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addAutomationAction,
  addAutomationCondition,
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  listAutomationRuns,
  updateAutomationRule,
} from '@/lib/domain/automation/rules';
import {
  createMessageTemplate,
  deleteMessageTemplate,
  listMessageDeliveries,
  updateMessageTemplate,
} from '@/lib/domain/automation/templates';
import { createAsset } from '@/lib/domain/assets/assets';
import {
  listAssetReadings,
  recordAssetReading,
} from '@/lib/domain/assets/readings';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  createLocation,
  setLocationCoordinates,
} from '@/lib/domain/locations/locations';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import {
  createWorkItemStatus,
  listWorkItemStatuses,
} from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition } from '@/lib/domain/work-items/transitions';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import {
  createWorkItem,
  listWorkItems,
  updateWorkItem,
} from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The automation runtime, and the four claims that make it worth having.
 *
 * **It runs where a person is not.** A rule is written by a member holding
 * `automation.manage` and then runs in transactions that member is not in — including one
 * started by a stranger with no membership at all. That is why the runtime is in the database
 * (D30) and why these tests exercise the path rather than a function.
 *
 * **A bad rule may not break a good write.** Every rule runs in its own subtransaction, so a
 * business that writes a rule its own lifecycle forbids gets a recorded failure and keeps the
 * job that tripped it. Before this milestone a failure here would have been a `DomainError`
 * raised, rendered and dropped; `automation_runs` is the substrate `roadmap.md` M5 deferred.
 *
 * **An automation may not do what a person may not do.** `app.check_status_transition` fires on
 * a rule's write exactly as it fires on a human's (I13), which is the difference between a
 * runtime and a back door.
 *
 * **And it stays inside one tenant.** Two businesses run rules that share every word.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Business = {
  db: SupabaseClient;
  email: string;
  userId: string;
  organizationId: string;
  typeId: string;
  requestedId: string;
  confirmedId: string;
  unreachableId: string;
};

let one: Business;
let two: Business;

async function newAccount(label: string): Promise<{ email: string; password: string; id: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return { email, password, id: data.user.id };
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

/**
 * A business with a lifecycle that has a hole in it, on purpose.
 *
 * Requested → Confirmed is wired. Requested → Unreachable is not, and no rule anywhere may
 * cross it — which is the assertion that separates a runtime from a way around the rules.
 */
async function newBusiness(label: string): Promise<Business> {
  const account = await newAccount(label);
  const db = await signIn(account.email, account.password);

  const organizationId = await foundBusiness({
    ownerEmail: account.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  await setModuleEnabled(db, { organizationId, key: 'automations', enabled: true });

  const typeId = await createWorkItemType(db, { schedulable: true, organizationId, name: 'Callout' });
  const requestedId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Requested',
    position: 0,
  });
  const confirmedId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Confirmed',
    position: 1,
  });
  const unreachableId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Unreachable',
    position: 2,
  });

  await createWorkItemTransition(db, {
    organizationId,
    typeId,
    fromStatusId: requestedId,
    toStatusId: confirmedId,
  });

  return {
    db,
    email: account.email,
    userId: account.id,
    organizationId,
    typeId,
    requestedId,
    confirmedId,
    unreachableId,
  };
}

async function statusOf(business: Business, workItemId: string): Promise<string | null> {
  const items = await listWorkItems(business.db, {
    organizationId: business.organizationId,
    typeId: business.typeId,
  });
  return items.find((item) => item.id === workItemId)?.status.id ?? null;
}

describe('rules a business writes', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    [one, two] = await Promise.all([newBusiness('auto-one'), newBusiness('auto-two')]);
  });

  it('starts with none, because the platform has written none', async () => {
    // No seeded rule, no suggested rule, no example. A business that has said nothing has said
    // nothing — the reading an empty operating-hours set already gets.
    expect(await listAutomationRules(one.db, { organizationId: one.organizationId })).toEqual([]);
  });

  it('moves a job on its own, and writes down that it did', async () => {
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Confirm a new callout',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'change_status',
      statusId: one.confirmedId,
    });

    const workItemId = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Van will not start',
    });

    expect(await statusOf(one, workItemId)).toBe(one.confirmedId);

    const runs = await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId });
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe('done');
    // Snapshotted, so renaming the rule tomorrow leaves this record saying what it said (I8).
    expect(runs[0].ruleName).toBe('Confirm a new callout');
    expect(runs[0].subjectId).toBe(workItemId);
  });

  it('cannot cross a transition this business has not wired (I13)', async () => {
    // **The claim that separates a runtime from a back door.** The rule is legitimate, the
    // status is this tenant's own, and the move is still refused — by the same trigger that
    // refuses a person.
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Give up immediately',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'change_status',
      statusId: one.unreachableId,
    });

    const workItemId = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Nobody in',
    });

    // **The job survived, which is the other half.** A rule failing must never roll back the
    // write that tripped it, and each rule runs in its own subtransaction so that the first
    // rule's success stands alongside this one's failure.
    expect(await statusOf(one, workItemId)).toBe(one.confirmedId);

    const failed = await listAutomationRuns(one.db, {
      organizationId: one.organizationId,
      ruleId,
    });
    expect(failed).toHaveLength(1);
    expect(failed[0].outcome).toBe('failed');
    // The database's own sentence, kept verbatim, because it names the actual problem: the
    // business wrote a rule that moves a job somewhere its own lifecycle forbids.
    expect(failed[0].detail).toBeTruthy();

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('keeps what a deleted rule did', async () => {
    // `automation_runs` holds no key to `automation_rules`, so the history above outlived the
    // rule deleted at the end of the previous case. That absence is the same one
    // `work_item_priced_lines` keeps against the price book (I8).
    const runs = await listAutomationRuns(one.db, {
      organizationId: one.organizationId,
      failedOnly: true,
    });
    expect(runs.some((run) => run.ruleName === 'Give up immediately')).toBe(true);
  });

  it('holds no foreign key from a run to its rule, and none may be added', async () => {
    // Asserted from the catalogue rather than from the reasoning, exactly as `prices.test.ts`
    // asserts the priced-line absence. A key added later for a perfectly good reason is the
    // first step to a report of what happened that tracks what is configured now.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select conname
           from pg_constraint
          where conrelid = 'public.automation_runs'::regclass
            and contype = 'f'
            and confrelid = 'public.automation_rules'::regclass`,
      );
      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('honours a condition, and takes no notice of a job that does not match', async () => {
    // The always-confirm rule from earlier is switched off for this case, because a rule that
    // finds a job already in the status it would have moved it to has nothing to do and records
    // nothing — correct behaviour, and it would hide what is being asserted here.
    const [always] = await listAutomationRules(one.db, { organizationId: one.organizationId });
    await updateAutomationRule(one.db, { id: always.id, enabled: false });

    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Confirm only what a customer asked for',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });
    await addAutomationCondition(one.db, {
      organizationId: one.organizationId,
      ruleId,
      subjectField: 'customer_id',
      operator: 'is_set',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'change_status',
      statusId: one.confirmedId,
    });

    // The first rule in this suite still confirms everything, so what is asserted here is the
    // run rather than the status: a rule that did not match records nothing at all.
    const withoutCustomer = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Walk-in',
    });

    expect(
      (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).filter(
        (run) => run.subjectId === withoutCustomer,
      ),
    ).toEqual([]);

    const customerId = await createCustomer(one.db, {
      organizationId: one.organizationId,
      name: 'A customer',
    });
    const withCustomer = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Booked in',
      customerId,
    });

    expect(
      (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).some(
        (run) => run.subjectId === withCustomer && run.outcome === 'done',
      ),
    ).toBe(true);

    await deleteAutomationRule(one.db, { id: ruleId });
    await updateAutomationRule(one.db, { id: always.id, enabled: true });
  });

  it('does nothing at all once it is switched off', async () => {
    const [rule] = await listAutomationRules(one.db, { organizationId: one.organizationId });
    await updateAutomationRule(one.db, { id: rule.id, enabled: false });

    const workItemId = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Left alone',
    });

    expect(await statusOf(one, workItemId)).toBe(one.requestedId);

    await updateAutomationRule(one.db, { id: rule.id, enabled: true });
  });

  it('stops entirely when the module is switched off', async () => {
    // Enforced in the database rather than in the navigation, which is the same shape
    // `20260829000010` gave public booking. A business that has switched automations off has
    // none, whatever rows it left behind.
    await setModuleEnabled(one.db, {
      organizationId: one.organizationId,
      key: 'automations',
      enabled: false,
    });

    const workItemId = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Module off',
    });

    expect(await statusOf(one, workItemId)).toBe(one.requestedId);

    await setModuleEnabled(one.db, {
      organizationId: one.organizationId,
      key: 'automations',
      enabled: true,
    });
  });

  it('never reaches the other business, whose rule shares every word', async () => {
    await createAutomationRule(two.db, {
      organizationId: two.organizationId,
      name: 'Confirm a new callout',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });

    // Both businesses now have a rule of that name. Neither can see the other's, and neither
    // fires on the other's work.
    const theirs = await listAutomationRules(two.db, { organizationId: two.organizationId });
    expect(theirs).toHaveLength(1);
    expect(theirs[0].id).not.toBe(
      (await listAutomationRules(one.db, { organizationId: one.organizationId }))[0].id,
    );

    const runs = await listAutomationRuns(two.db, { organizationId: two.organizationId });
    expect(runs).toEqual([]);
  });

  it('refuses a rule from a member who cannot write one, and shows it to them anyway', async () => {
    // I12 in its usual shape, and the half that is particular to this screen: reading is not
    // gated. A job that moves on its own must never be a mystery to the person watching it.
    const roleId = await createRole(one.db, {
      organizationId: one.organizationId,
      name: 'Dispatcher',
      capabilities: ALL_CAPABILITIES.filter((entry) => entry !== 'automation.manage'),
    });

    const colleague = await newAccount('auto-dispatch');
    await addMember(one.db, {
      organizationId: one.organizationId,
      email: colleague.email,
      roleId,
      displayName: 'Dispatcher',
    });
    const theirDb = await signIn(colleague.email, colleague.password);

    await expect(
      createAutomationRule(theirDb, {
        organizationId: one.organizationId,
        name: 'Something of my own',
        triggerKind: 'event',
        triggerEventAction: 'work_item.created',
      }),
    ).rejects.toMatchObject({ code: 'automations.forbidden' });

    const visible = await listAutomationRules(theirDb, { organizationId: one.organizationId });
    expect(visible.length).toBeGreaterThan(0);
    expect(
      (await listAutomationRuns(theirDb, { organizationId: one.organizationId })).length,
    ).toBeGreaterThan(0);
  });

  it('lets nobody write a run, through any path', async () => {
    // No insert policy and no grant, which is stricter than `events` — a member can append to
    // the timeline and nobody can append to this. A record of what the platform did that its
    // users can edit is worth nothing.
    const { error } = await one.db.from('automation_runs').insert({
      organization_id: one.organizationId,
      rule_id: randomUUID(),
      rule_name: 'Invented',
      trigger_kind: 'event',
      subject_type: 'work_item',
      subject_id: randomUUID(),
      outcome: 'done',
    });

    expect(error).not.toBeNull();
    // A privilege that does not exist rather than a policy declining. The difference is the
    // guarantee, so the code is asserted rather than merely a failure.
    expect(error?.code).toBe('42501');
  });

  it('cannot be impersonated by a member claiming to be one', async () => {
    // `app.acting_automation()` is what lets a rule write past the per-column capability guard,
    // and it is set only by `app.run_automation`. A caller who could set it could edit any job
    // in their tenant regardless of role, so what matters is that no path exposes it: PostgREST
    // issues no `SET`, and the function that reads it is not the function that writes it.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select has_function_privilege('authenticated', p.oid, 'execute') as granted
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'run_automation'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].granted).toBe(false);
    } finally {
      await client.end();
    }
  });

  it('attributes what it did to nobody, and names the rule instead (I11)', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select actor_id, payload
           from public.events
          where organization_id = $1
            and payload ? 'automation_rule_id'
          order by occurred_at desc
          limit 1`,
        [one.organizationId],
      );

      expect(rows).toHaveLength(1);
      // The same answer D26 gave the payment webhook: a real `auth.users` row that can never
      // sign in, rather than a second shape for the invariant.
      expect(rows[0].actor_id).toBe('00000000-0000-4000-8000-0000000000a2');
      expect(rows[0].payload.automation_rule_name).toBeTruthy();

      const { rows: actor } = await client.query(
        `select encrypted_password, email from auth.users
          where id = '00000000-0000-4000-8000-0000000000a2'`,
      );
      expect(actor[0].encrypted_password).toBeNull();
      expect(actor[0].email).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('does not let one automation trigger another', async () => {
    // Chaining is a feature and a cycle is an outage, and the rows cannot tell them apart. A
    // rule that fires on the very event an automation writes proves the guard: if it ran, this
    // suite would not finish.
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'React to a status change',
      triggerKind: 'event',
      triggerEventAction: 'work_item.status_changed',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'change_status',
      statusId: one.requestedId,
    });

    const workItemId = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'No cascade',
    });

    // The first rule confirmed it. The second rule watches for exactly that and did not run.
    expect(await statusOf(one, workItemId)).toBe(one.confirmedId);
    expect(
      (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).length,
    ).toBe(0);

    await deleteAutomationRule(one.db, { id: ruleId });
  });
});

/**
 * The clock, and what it may reach.
 *
 * **Everything about *what is due* is a query** (D24: a scheduled invocation asks, it does not
 * hold a queue), so it is exercised here rather than in Python — the same division
 * `adapters.test.ts` makes for the payment webhook, where the handler's own logic is tested in
 * its own language and the privileges are tested against the database that grants them.
 */
describe('the clock', () => {
  it('runs a rule when the moment it names arrives, and not before', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();

    try {
      const resource = await createResource(one.db, {
        organizationId: one.organizationId,
        name: 'Van',
      });

      // The always-confirm rule from earlier would move this job the moment it is created, and
      // then the timed rule below would find it already where it wanted it. Switched off for the
      // length of this case so the clock is the only thing acting.
      const [always] = await listAutomationRules(one.db, { organizationId: one.organizationId });
      await updateAutomationRule(one.db, { id: always.id, enabled: false });

      // Two hours before the job starts. The job below starts in one hour, so the moment this
      // rule names passed an hour ago and it is due now.
      const ruleId = await createAutomationRule(one.db, {
        organizationId: one.organizationId,
        name: 'Remind the customer',
        triggerKind: 'schedule',
        triggerMinutesBefore: 120,
      });
      await addAutomationAction(one.db, {
        organizationId: one.organizationId,
        ruleId,
        kind: 'change_status',
        statusId: one.confirmedId,
      });

      const workItemId = await createWorkItem(one.db, {
        organizationId: one.organizationId,
        statusId: one.requestedId,
        title: 'Coming up',
      });

      const starts = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await scheduleWorkItem(one.db, {
        workItemId,
        resourceId: resource,
        startsAt: starts,
        endsAt: ends,
      });

      const { rows } = await client.query('select public.run_due_automations() as ran');
      expect(Number(rows[0].ran)).toBeGreaterThan(0);

      expect(await statusOf(one, workItemId)).toBe(one.confirmedId);

      const runs = await listAutomationRuns(one.db, {
        organizationId: one.organizationId,
        ruleId,
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].outcome).toBe('done');

      // **Running twice is running once.** Nothing bookkeeps that: the rule has a run against
      // this job so it is no longer due, and every action this platform has is one that a
      // repeat leaves alone anyway.
      const { rows: again } = await client.query('select public.run_due_automations() as ran');
      expect(Number(again[0].ran)).toBe(0);
      expect(
        (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).length,
      ).toBe(1);

      await deleteAutomationRule(one.db, { id: ruleId });
      await updateAutomationRule(one.db, { id: always.id, enabled: true });
    } finally {
      await client.end();
    }
  });

  it('gives the runner five functions and no table at all', async () => {
    // I21's shape on a fourth axis, and the reason it is asserted from `information_schema`
    // rather than from the migration: a permissive policy added later still hits a missing
    // privilege, and the difference between a policy declining and a privilege not existing is
    // the whole guarantee.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows: tables } = await client.query(
        `select table_name, privilege_type
           from information_schema.role_table_grants
          where grantee = 'automation_runner'`,
      );
      expect(tables).toEqual([]);

      const { rows: functions } = await client.query(
        `select p.proname
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('automation_runner', p.oid, 'execute')
            and p.proname not in (
              select proname from pg_proc pp
               join pg_namespace nn on nn.oid = pp.pronamespace
              where nn.nspname = 'public' and has_function_privilege('public', pp.oid, 'execute')
            )
          order by p.proname`,
      );
      // Five, and the list is exhaustive rather than a sample: what makes this assertion worth
      // anything is that adding a sixth fails here, so somebody has to argue for it.
      expect(functions.map((row) => row.proname)).toEqual([
        'places_to_watch',
        'queued_messages',
        'record_external_readings',
        'record_message_delivery',
        'run_due_automations',
      ]);
    } finally {
      await client.end();
    }
  });
});

/**
 * Telling somebody, once, in the business's own words.
 */
describe('what a rule says', () => {
  let templateId: string;
  let customerId: string;

  beforeAll(async () => {
    templateId = await createMessageTemplate(one.db, {
      organizationId: one.organizationId,
      name: 'Booking confirmation',
      subject: 'Your booking with {{business}}',
      body: 'Hello {{customer}}, {{job}} is booked. — {{business}}',
    });
    customerId = await createCustomer(one.db, {
      organizationId: one.organizationId,
      name: 'Ana',
      email: `ana-${randomUUID().slice(0, 8)}@example.test`,
    });
  });

  it('queues exactly what the business wrote, with nothing added', async () => {
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Confirm by email',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'notify',
      templateId,
      channel: 'email',
    });

    const workItemId = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Two tyres',
      customerId,
    });

    const [delivery] = await listMessageDeliveries(one.db, {
      organizationId: one.organizationId,
      subjectId: workItemId,
    });

    // **The assertion I24 exists for.** Not "contains", not "starts with" — exactly. A greeting,
    // a signature or a footer added by any layer would fail here, which is the point: a message
    // arrives in somebody's inbox with this business's name on it, and every word has to be
    // theirs.
    expect(delivery.body).toBe('Hello Ana, Two tyres is booked. — auto-one Ltd');
    expect(delivery.subjectLine).toBe('Your booking with auto-one Ltd');
    expect(delivery.state).toBe('queued');

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('writes to the same person twice about two jobs, and never twice about one', async () => {
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Confirm every job by email',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'notify',
      templateId,
      channel: 'email',
    });

    const first = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Front pads',
      customerId,
    });
    const second = await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Rear pads',
      customerId,
    });

    // Two jobs, two reasons, two messages. That is the half the index must not prevent.
    expect(
      (await listMessageDeliveries(one.db, { organizationId: one.organizationId, subjectId: first }))
        .length,
    ).toBe(1);
    expect(
      (await listMessageDeliveries(one.db, {
        organizationId: one.organizationId,
        subjectId: second,
      })).length,
    ).toBe(1);

    // And editing the first job trips the rule again about a job this rule has already written
    // about — refused by `message_deliveries_once_per_reason`, silently, because the customer
    // has already been told and that is not a failure.
    await updateWorkItem(one.db, {
      organizationId: one.organizationId,
      id: first,
      title: 'Front pads and discs',
      customerId,
    });
    expect(
      (await listMessageDeliveries(one.db, { organizationId: one.organizationId, subjectId: first }))
        .length,
    ).toBe(1);

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('leaves a sent message alone when the template is rewritten (I8)', async () => {
    const [delivery] = await listMessageDeliveries(one.db, {
      organizationId: one.organizationId,
    });

    await updateMessageTemplate(one.db, {
      id: templateId,
      name: 'Booking confirmation',
      subject: 'Something else entirely',
      body: 'Different words.',
    });

    const [after] = await listMessageDeliveries(one.db, {
      organizationId: one.organizationId,
    });
    expect(after.body).toBe(delivery.body);
    expect(after.subjectLine).toBe(delivery.subjectLine);
  });

  it('records a failure when there is nobody to write to', async () => {
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Write to nobody',
      triggerKind: 'event',
      triggerEventAction: 'work_item.created',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'notify',
      templateId,
      channel: 'email',
    });

    await createWorkItem(one.db, {
      organizationId: one.organizationId,
      statusId: one.requestedId,
      title: 'Nobody attached',
    });

    const runs = await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId });
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe('failed');
    // The sentence tells an operator what to do about it, which is what conditions are for.
    expect(runs[0].detail).toContain('condition');

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('lets nobody edit what was sent', async () => {
    const [delivery] = await listMessageDeliveries(one.db, {
      organizationId: one.organizationId,
    });

    const { error } = await one.db
      .from('message_deliveries')
      .update({ body: 'something I never said' })
      .eq('id', delivery.id);

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('refuses to remove a template a rule still writes from', async () => {
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Still using it',
      triggerKind: 'event',
      triggerEventAction: 'work_item.updated',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'notify',
      templateId,
      channel: 'email',
    });

    // Removing it silently would leave that rule failing every time it ran, which is worse than
    // refusing here where somebody can see why.
    await expect(deleteMessageTemplate(one.db, { id: templateId })).rejects.toMatchObject({
      code: 'messages.template_in_use',
    });

    await deleteAutomationRule(one.db, { id: ruleId });
  });
});

/**
 * Weather, which is an integration plus rules and nothing else (D11).
 *
 * There is no weather table in this schema, no weather entity in the domain layer and no
 * directory named after it. What exists is a reading somebody outside took, a threshold a
 * business typed, and an action that moves a job — three things that had to exist anyway.
 *
 * **The sharpest assertion here is the one about units.** A rule written in one unit against a
 * reading taken in another does not half-work: it does not fire at all. That is the same refusal
 * `jobEconomics` makes about currency, and it is deliberate — converting has a date, and a date
 * makes this a different kind of software.
 */
describe('conditions at a job', () => {
  let locationId: string;
  let resourceId: string;

  beforeAll(async () => {
    locationId = await createLocation(one.db, {
      organizationId: one.organizationId,
      label: 'The yard',
      address: 'Herengracht 1, Amsterdam',
    });
    await setLocationCoordinates(one.db, {
      id: locationId,
      latitude: 52.370216,
      longitude: 4.895168,
    });
    resourceId = await createResource(one.db, {
      organizationId: one.organizationId,
      name: 'Crane',
    });
  });

  it('lets nobody type their own reading', async () => {
    // A business that could write its own readings could make its own rules fire. There is no
    // insert policy and no insert grant, so the refusal is a missing privilege rather than a
    // policy declining — which is the difference that survives a careless policy author.
    const { error } = await one.db.from('external_readings').insert({
      organization_id: one.organizationId,
      location_id: locationId,
      metric: 'wind_speed',
      value: 99,
      unit: 'km/h',
      applies_at: new Date().toISOString(),
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('moves a job when the reading crosses the line the business drew', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();

    try {
      const [always] = await listAutomationRules(one.db, { organizationId: one.organizationId });
      await updateAutomationRule(one.db, { id: always.id, enabled: false });

      const ruleId = await createAutomationRule(one.db, {
        organizationId: one.organizationId,
        name: 'Too windy for the crane',
        triggerKind: 'external_reading',
        triggerMetric: 'wind_speed',
        triggerComparison: 'above',
        triggerThreshold: 50,
        triggerUnit: 'km/h',
      });
      await addAutomationAction(one.db, {
        organizationId: one.organizationId,
        ruleId,
        kind: 'shift_schedule',
        shiftMinutes: 1440,
      });

      const workItemId = await createWorkItem(one.db, {
        organizationId: one.organizationId,
        statusId: one.requestedId,
        title: 'Lift the roof panels',
        locationId,
      });

      const starts = new Date(Date.now() + 3 * 60 * 60 * 1000);
      const ends = new Date(Date.now() + 5 * 60 * 60 * 1000);
      await scheduleWorkItem(one.db, {
        workItemId,
        resourceId,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
      });

      // A reading in the wrong unit first. Same place, same hour, comfortably over the number —
      // and it does not fire, because a threshold in kilometres per hour and a reading in miles
      // per hour are not about the same thing.
      await client.query(
        `select public.record_external_readings($1, jsonb_build_array(jsonb_build_object(
             'metric', 'wind_speed', 'value', 80, 'unit', 'mph', 'applies_at', $2::timestamptz)))`,
        [locationId, starts.toISOString()],
      );
      await client.query('select public.run_due_automations()');

      expect(
        (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).length,
      ).toBe(0);

      // Now in the unit the rule was written in.
      await client.query(
        `select public.record_external_readings($1, jsonb_build_array(jsonb_build_object(
             'metric', 'wind_speed', 'value', 80, 'unit', 'km/h', 'applies_at', $2::timestamptz)))`,
        [locationId, starts.toISOString()],
      );
      await client.query('select public.run_due_automations()');

      const runs = await listAutomationRuns(one.db, {
        organizationId: one.organizationId,
        ruleId,
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].outcome).toBe('done');

      const moved = (
        await listWorkItems(one.db, { organizationId: one.organizationId })
      ).find((item) => item.id === workItemId);
      // A day later, which is what the business typed. Nothing searched for a free slot: that
      // would be a second availability calculation, which I5 forbids (D30).
      expect(new Date(moved!.window!.startsAt).getTime()).toBe(
        starts.getTime() + 24 * 60 * 60 * 1000,
      );

      await deleteAutomationRule(one.db, { id: ruleId });
      await updateAutomationRule(one.db, { id: always.id, enabled: true });
    } finally {
      await client.end();
    }
  });

  it('records a failure when the slot it would move into is taken', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();

    try {
      const [always] = await listAutomationRules(one.db, { organizationId: one.organizationId });
      await updateAutomationRule(one.db, { id: always.id, enabled: false });

      const starts = new Date(Date.now() + 10 * 60 * 60 * 1000);
      const ends = new Date(Date.now() + 11 * 60 * 60 * 1000);

      const blocked = await createWorkItem(one.db, {
        organizationId: one.organizationId,
        statusId: one.requestedId,
        title: 'Gutter clearing',
        locationId,
      });
      await scheduleWorkItem(one.db, {
        workItemId: blocked,
        resourceId,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
      });

      // The hour this job would be pushed into, already held by somebody else on the same
      // resource. **Nothing looks before it writes** — the exclusion constraint refuses the move
      // in the transaction that would have made it, which is I6 doing what it exists for.
      // **No location, deliberately.** With one it would match this rule too, both jobs would
      // be due at once, and which of them moved first would decide whether either failed — a
      // test that passes or fails on the order a `union all` happens to return. The rule cares
      // about conditions at a place, so a job with no place is not its business.
      const inTheWay = await createWorkItem(one.db, {
        organizationId: one.organizationId,
        statusId: one.requestedId,
        title: 'Already booked',
      });
      await scheduleWorkItem(one.db, {
        workItemId: inTheWay,
        resourceId,
        startsAt: new Date(starts.getTime() + 60 * 60 * 1000).toISOString(),
        endsAt: new Date(ends.getTime() + 60 * 60 * 1000).toISOString(),
      });

      // **The rule is written after the fixture, and that ordering is load-bearing.** The test
      // above leaves a 4mm reading at this location, so this rule is *due the instant it
      // exists* — and `run_due_automations()` is global while vitest runs files in parallel, so
      // any tick from any other suite could fire it. Created earlier, it shifted `blocked`
      // forward an hour into the slot `inTheWay` was about to take, and the fixture failed to
      // build with the double-booking message this test exists to produce later. Intermittent,
      // because it needed a concurrent tick to land in that window.
      const ruleId = await createAutomationRule(one.db, {
        organizationId: one.organizationId,
        name: 'Push it back an hour',
        triggerKind: 'external_reading',
        triggerMetric: 'precipitation',
        triggerComparison: 'above',
        triggerThreshold: 1,
        triggerUnit: 'mm',
      });
      await addAutomationAction(one.db, {
        organizationId: one.organizationId,
        ruleId,
        kind: 'shift_schedule',
        shiftMinutes: 60,
      });

      await client.query(
        `select public.record_external_readings($1, jsonb_build_array(jsonb_build_object(
             'metric', 'precipitation', 'value', 4, 'unit', 'mm', 'applies_at', $2::timestamptz)))`,
        [locationId, starts.toISOString()],
      );
      await client.query('select public.run_due_automations()');

      const runs = await listAutomationRuns(one.db, {
        organizationId: one.organizationId,
        ruleId,
      });
      expect(runs.some((run) => run.subjectId === blocked && run.outcome === 'failed')).toBe(true);

      // And the job did not move. A recorded failure a dispatcher reads is a better answer than
      // a rule that quietly gives up.
      const unmoved = (
        await listWorkItems(one.db, { organizationId: one.organizationId })
      ).find((item) => item.id === blocked);
      expect(new Date(unmoved!.window!.startsAt).getTime()).toBe(starts.getTime());

      await deleteAutomationRule(one.db, { id: ruleId });
      await updateAutomationRule(one.db, { id: always.id, enabled: true });
    } finally {
      await client.end();
    }
  });
});

/**
 * The third trigger shape, and the one this milestone was warned about.
 *
 * `constraints.md` names it under *Decided, not yet built*: a schedule fires at a time, weather
 * fires on somebody else's number, and this fires when **an accumulated counter a human or a
 * sensor advances crosses a threshold** — a shape a when/if/then runtime built for events does
 * not express naturally. The four hundredth hour is the event, and nothing happened at any
 * particular moment to announce it.
 */
describe('a counter crossing a line', () => {
  let assetId: string;
  let ruleId: string;

  beforeAll(async () => {
    assetId = await createAsset(one.db, {
      organizationId: one.organizationId,
      name: 'Compressor',
    });

    ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Service the compressor',
      triggerKind: 'counter_threshold',
      triggerCounterStep: 100,
      triggerUnit: 'hours',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'create_work_item',
      typeId: one.typeId,
      statusId: one.requestedId,
    });
  });

  it('takes the first reading as a starting point and raises nothing', async () => {
    // **Switching a rule on for a machine that has already run nine hundred hours must not raise
    // nine services that were done years ago.** What a business means is "from here", and the
    // first reading is what "here" is.
    await recordAssetReading(one.db, {
      organizationId: one.organizationId,
      assetId,
      value: 900,
      unit: 'hours',
    });

    expect(
      (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).length,
    ).toBe(0);
  });

  it('raises nothing until the interval has actually passed', async () => {
    await recordAssetReading(one.db, {
      organizationId: one.organizationId,
      assetId,
      value: 950,
      unit: 'hours',
    });

    expect(
      (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).length,
    ).toBe(0);
  });

  it('raises a job when it has, titled with the rule’s own name', async () => {
    await recordAssetReading(one.db, {
      organizationId: one.organizationId,
      assetId,
      value: 1005,
      unit: 'hours',
    });

    const runs = await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId });
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe('done');
    // The subject is the machine, not a job. This is the shape that would not have existed if
    // the runtime had been built for events alone.
    expect(runs[0].subjectType).toBe('asset');
    expect(runs[0].subjectId).toBe(assetId);

    const raised = (await listWorkItems(one.db, { organizationId: one.organizationId })).filter(
      (item) => item.title === 'Service the compressor',
    );
    expect(raised).toHaveLength(1);
    // Attached to the machine it is about, which is the whole reason a counter rule knows which
    // asset it fired for.
    expect(raised[0].asset?.id).toBe(assetId);
  });

  it('takes no notice of a reading in another unit', async () => {
    // Compared, never converted — the same refusal the weather rules make, and the same reason:
    // a rule counting hours and a reading in kilometres are about different things.
    const before = (
      await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })
    ).length;

    await recordAssetReading(one.db, {
      organizationId: one.organizationId,
      assetId,
      value: 99999,
      unit: 'km',
    });

    expect(
      (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).length,
    ).toBe(before);
  });

  it('owes the intervals a big jump skipped rather than swallowing them', async () => {
    // The mark advances by whole steps, so a business that reads its meter monthly and services
    // every hundred hours gets every service — one now, and the rest at the next readings.
    await recordAssetReading(one.db, {
      organizationId: one.organizationId,
      assetId,
      value: 1400,
      unit: 'hours',
    });

    const after = await listAutomationRuns(one.db, {
      organizationId: one.organizationId,
      ruleId,
    });
    expect(after.length).toBe(2);

    // Still owing: the mark is at 1100 and the counter reads 1400, so the next reading trips it
    // again without the counter having moved at all.
    await recordAssetReading(one.db, {
      organizationId: one.organizationId,
      assetId,
      value: 1400,
      unit: 'hours',
    });
    expect(
      (await listAutomationRuns(one.db, { organizationId: one.organizationId, ruleId })).length,
    ).toBe(3);
  });

  it('refuses a condition on a counter rule rather than ignoring one', async () => {
    // **Refused, not ignored**, and that is the point. Every condition this platform has looks
    // at a job, and this rule runs about a machine before any job exists — so a condition here
    // would be written, believed and never consulted.
    await expect(
      addAutomationCondition(one.db, {
        organizationId: one.organizationId,
        ruleId,
        subjectField: 'title',
        operator: 'is_set',
      }),
    ).rejects.toMatchObject({ code: 'automations.conditions_not_applicable' });
  });

  it('lets nobody rewrite a counter', async () => {
    // Append-only, like `events` and like a recorded cost. A counter that could be edited
    // backwards could be made to trip a rule twice, or never.
    const [reading] = await listAssetReadings(one.db, {
      organizationId: one.organizationId,
      assetId,
    });

    const { error } = await one.db
      .from('asset_readings')
      .update({ value: 0 })
      .eq('id', reading.id);

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});

/**
 * Reading a business's rules back to it.
 *
 * **These catch the failures nothing else can.** A rule that fails leaves a row somebody can
 * read; a rule that *never fires* leaves nothing at all, because nothing happened — and on
 * screen that is indistinguishable from a quiet week. A threshold in a unit no reading uses, a
 * status nothing can move into, a message rule on jobs that have no customer: all silent, all
 * catchable before anything runs.
 *
 * Every one of these is arithmetic on rows the business already has. None of it is AI, and the
 * harder question a language model would answer — what will this do to the people receiving it —
 * wants these answers underneath it either way.
 */
describe('reading the rules back', () => {
  async function review(rules: Awaited<ReturnType<typeof listAutomationRules>>) {
    const own = await listWorkItemStatuses(one.db, {
      organizationId: one.organizationId,
      typeId: one.typeId,
    });
    return reviewAutomationRules(one.db, {
      organizationId: one.organizationId,
      rules,
      statuses: own.map((status) => ({
        id: status.id,
        typeId: one.typeId,
        name: status.name,
        typeName: 'Callout',
      })),
    });
  }

  it('says nothing about a rule that is fine', async () => {
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'A rule with nothing wrong with it',
      triggerKind: 'event',
      triggerEventAction: 'work_item.booked',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'change_status',
      statusId: one.confirmedId,
    });

    const rules = await listAutomationRules(one.db, { organizationId: one.organizationId });
    const warnings = await review(rules);

    expect(warnings.filter((warning) => warning.ruleId === ruleId)).toEqual([]);

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('catches a status nothing can move into, before it fails once', async () => {
    // `Unreachable` has no transition pointing at it, so every run of this rule is refused by
    // `app.check_status_transition`. Today a business finds that out by watching it fail; this
    // says so while they are still looking at the rule.
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Move it somewhere unreachable',
      triggerKind: 'event',
      triggerEventAction: 'work_item.booked',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'change_status',
      statusId: one.unreachableId,
    });

    const rules = await listAutomationRules(one.db, { organizationId: one.organizationId });
    const warnings = await review(rules);

    expect(warnings.some((w) => w.ruleId === ruleId && w.message.includes('Unreachable'))).toBe(
      true,
    );

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('catches a threshold in a unit no reading has ever used', async () => {
    // **The worst mistake this platform allows, and the quietest.** Units are compared and never
    // converted, so `kph` against readings that say `km/h` is not a rule that half-works — it is
    // a rule that is silent forever, on a screen showing nothing wrong.
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Windy, in the wrong words',
      triggerKind: 'external_reading',
      triggerMetric: 'wind_speed',
      triggerComparison: 'above',
      triggerThreshold: 50,
      triggerUnit: 'kph',
    });

    const rules = await listAutomationRules(one.db, { organizationId: one.organizationId });
    const warnings = await review(rules);

    // Joined, because this rule earns two warnings — it also has no action yet — and a rule with
    // several things wrong with it should say all of them rather than the first.
    const said = warnings
      .filter((w) => w.ruleId === ruleId)
      .map((w) => w.message)
      .join(' ');
    expect(said).toContain('never fire');
    // And it names what the readings actually say, so the fix is obvious rather than a guess.
    expect(said).toContain('km/h');

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('catches a message rule that will fail on every job with no customer', async () => {
    const templateId = await createMessageTemplate(one.db, {
      organizationId: one.organizationId,
      name: 'Anything at all',
      subject: 'Hello',
      body: 'Hello {{customer}}.',
    });
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Tell everybody',
      triggerKind: 'event',
      triggerEventAction: 'work_item.booked',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'notify',
      templateId,
      channel: 'email',
    });

    const rules = await listAutomationRules(one.db, { organizationId: one.organizationId });
    let warnings = await review(rules);
    expect(warnings.some((w) => w.ruleId === ruleId && w.message.includes('no customer'))).toBe(
      true,
    );

    // And it stops saying so once the business has done what it suggested, which is the whole
    // difference between advice and noise.
    await addAutomationCondition(one.db, {
      organizationId: one.organizationId,
      ruleId,
      subjectField: 'customer_id',
      operator: 'is_set',
    });

    warnings = await review(
      await listAutomationRules(one.db, { organizationId: one.organizationId }),
    );
    expect(warnings.some((w) => w.ruleId === ruleId && w.message.includes('no customer'))).toBe(
      false,
    );

    await deleteAutomationRule(one.db, { id: ruleId });
  });

  it('catches two rules that will fight over the same moment', async () => {
    const first = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'One opinion',
      triggerKind: 'event',
      triggerEventAction: 'work_item.unscheduled',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId: first,
      kind: 'change_status',
      statusId: one.confirmedId,
    });

    const second = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Another opinion',
      triggerKind: 'event',
      triggerEventAction: 'work_item.unscheduled',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId: second,
      kind: 'change_status',
      statusId: one.requestedId,
    });

    const warnings = await review(
      await listAutomationRules(one.db, { organizationId: one.organizationId }),
    );

    // Both are warned, because from either rule's side the other one is the surprise.
    expect(warnings.some((w) => w.ruleId === first && w.message.includes('same moment'))).toBe(true);
    expect(warnings.some((w) => w.ruleId === second && w.message.includes('same moment'))).toBe(
      true,
    );

    await deleteAutomationRule(one.db, { id: first });
    await deleteAutomationRule(one.db, { id: second });
  });

  it('says nothing about a rule that is switched off', async () => {
    // A business that has switched a rule off has already decided about it. Warning them anyway
    // would make the screen argue with a decision they took deliberately.
    const ruleId = await createAutomationRule(one.db, {
      organizationId: one.organizationId,
      name: 'Parked for now',
      triggerKind: 'event',
      triggerEventAction: 'work_item.booked',
    });
    await addAutomationAction(one.db, {
      organizationId: one.organizationId,
      ruleId,
      kind: 'change_status',
      statusId: one.unreachableId,
    });
    await updateAutomationRule(one.db, { id: ruleId, enabled: false });

    const warnings = await review(
      await listAutomationRules(one.db, { organizationId: one.organizationId }),
    );
    expect(warnings.filter((w) => w.ruleId === ruleId)).toEqual([]);

    await deleteAutomationRule(one.db, { id: ruleId });
  });
});
