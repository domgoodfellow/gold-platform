import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { claimPortalInvite, createPortalInvite } from '@/lib/domain/portal/portal';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { decideOnAction } from '@/lib/domain/assistant/questions';
import { executorFor, reasonActionCannotRun } from '@/lib/domain/assistant/actions';
import { foundBusiness } from '@/tests/support/founding';

/**
 * What a tool is, and what keeps one from reading a row its caller could not.
 *
 * `constraints.md` D34 holds the reasoning. Two halves are asserted here and they are not the
 * same claim:
 *
 *   * **A tool cannot write, and cannot see past the person who called it.** Not because the
 *     loop is careful — the loop is in another runtime and another language — but because a tool
 *     is a `stable`, `security invoker` function in this database, and both of those are facts
 *     in `pg_proc` that this file reads.
 *
 *   * **The argument is not what narrows.** This is the one that matters, and it is the failure
 *     mode a tool layer invites: a model chooses a tool's arguments, so if `p_organization_id`
 *     were what kept a caller inside their own business, the protection would be a value the
 *     model made up. The test below hands one business's id to another business's session and
 *     to a portal customer, and gets nothing back both times.
 *
 * **No model is called here, deliberately.** What D34 decides is structural, and a test that
 * asked a provider would be asserting somebody else's judgement, slowly and for money. The loop
 * has its own tests in `apps/api`, which are not in the gate — `apps/api/README.md` names that
 * gap, and it is the reason everything load-bearing is asserted from this side.
 */

const REPO = new URL('../../../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Business = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  customerId: string;
  lateTitle: string;
  lateId: string;
  resourceId: string;
};

let yard: Business;
let clinic: Business;

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Every Postgres function the tool registry names.
 *
 * **Read out of the Python source rather than restated here**, because a list of tool names
 * maintained on both sides of the seam is the hand-kept mirror D2 refuses by name. There is one
 * registry, it lives where the loop lives, and this file reads it.
 */
function registeredTools(): string[] {
  const source = readFileSync(join(REPO, 'apps', 'api', 'app', 'ai', 'tools.py'), 'utf8');
  return [...source.matchAll(/function="([a-z_]+)"/g)].map((match) => match[1]);
}

/** The conversation a run is filed under — a run cannot exist outside one, and only its asker can start it. */
async function conversationFor(business: Pick<Business, 'db' | 'organizationId' | 'userId'>): Promise<string> {
  const { data, error } = await business.db
    .from('agent_conversations')
    .insert({ organization_id: business.organizationId, created_by: business.userId, title: 'A conversation' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** A business with one job that is running late and one that is not. */
async function newBusiness(label: string): Promise<Business> {
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

  const db = anonClient();
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  // **Neither business thinks in UTC, and that is the point.** Every test in this repository
  // founded a UTC business until a real model was asked a real question and answered an hour
  // wrong for Amsterdam and nine for Cebu — a whole class of defect that a UTC fixture cannot
  // see, because in UTC the rendered time and the instant are the same string.
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    currency: 'EUR',
    timezone: label === 'tool-yard' ? 'America/New_York' : 'Asia/Tokyo',
  });

  // Each business's own words, and they share none. What the tool reports back is the tenant's
  // status name rather than a platform one, which is the same claim M3 makes about configuring.
  const typeId = await createWorkItemType(db, { schedulable: true,
    organizationId,
    name: label === 'tool-yard' ? 'Verhuur' : 'Shinsatsu',
  });
  const holding = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: label === 'tool-yard' ? 'Op de planning' : 'Shinsatsu-chū',
  });

  const resourceId = await createResource(db, { resourceClass: 'other',
    organizationId,
    name: label === 'tool-yard' ? 'Kraan' : 'Shinsatsushitsu 1',
  });

  const customerId = await createCustomer(db, {
    organizationId,
    name: `${label} customer`,
  });

  const lateTitle = `${label} overran`;
  const late = await createWorkItem(db, {
    organizationId,
    title: lateTitle,
    statusId: holding,
    customerId,
  });

  // Yesterday, and still in a status the business has not marked as releasing its resource.
  const from = new Date(Date.now() - 26 * 60 * 60 * 1000);
  const to = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await scheduleWorkItem(db, {
    workItemId: late,
    resourceIds: [resourceId],
    startsAt: from.toISOString(),
    endsAt: to.toISOString(),
  });

  // A second job about somebody else, so "the portal customer sees only theirs" has something
  // to hide rather than an empty list that would pass for the wrong reason.
  const otherCustomerId = await createCustomer(db, {
    organizationId,
    name: `${label} somebody else`,
  });
  const theirs = await createWorkItem(db, {
    organizationId,
    title: `${label} not yours`,
    statusId: holding,
    customerId: otherCustomerId,
  });
  await scheduleWorkItem(db, {
    workItemId: theirs,
    resourceIds: [resourceId],
    startsAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() - 29 * 60 * 60 * 1000).toISOString(),
  });

  await setModuleEnabled(db, { organizationId, key: 'portal', enabled: true });

  return {
    db,
    userId: created.user.id,
    organizationId,
    customerId,
    lateTitle,
    lateId: late,
    resourceId,
  };
}

/** One tool call, exactly as the loop makes it: an RPC under the caller's own session. */
async function askTool(db: SupabaseClient, organizationId: string) {
  const { data, error } = await db.rpc('work_at_risk', { p_organization_id: organizationId });
  if (error) throw error;
  return (data ?? []) as {
    title: string;
    status: string;
    reason: string;
    scheduled_from: string;
    starts_local: string;
    time_zone: string;
  }[];
}

async function askQuiet(db: SupabaseClient, organizationId: string, days: number) {
  const { data, error } = await db.rpc('customers_not_contacted', {
    p_organization_id: organizationId,
    p_days: days,
  });
  if (error) throw error;
  return (data ?? []) as {
    customer_id: string;
    name: string;
    last_activity: string | null;
    days_since: number | null;
  }[];
}

describe('a tool is a function in this database (D34)', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    yard = await newBusiness('tool-yard');
    clinic = await newBusiness('tool-clinic');
  });

  it('every registered tool exists, cannot write, and runs as its invoker', async () => {
    const names = registeredTools();
    // A registry that read as empty would make every assertion below vacuously true, which is
    // exactly how this kind of test rots.
    expect(names.length).toBeGreaterThan(0);

    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select p.proname, p.provolatile, p.prosecdef
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = any($1::text[])`,
        [names],
      );

      expect(rows.map((row) => row.proname).sort()).toEqual([...names].sort());

      for (const row of rows) {
        // `v` is volatile, which is what Postgres would need for the function to be allowed to
        // write. `s` (stable) and `i` (immutable) are refused at execution — checked against a
        // live probe rather than assumed, and the refusal reads *DELETE is not allowed in a
        // non-volatile function*.
        expect(row.provolatile, `${row.proname} is volatile`).not.toBe('v');
        // `security definer` would run the tool as its owner and see every tenant, which is the
        // whole boundary gone in one keyword.
        expect(row.prosecdef, `${row.proname} runs as its owner`).toBe(false);
      }
    } finally {
      await client.end();
    }
  });

  it('answers each business about its own work, in that business’s own words', async () => {
    const mine = await askTool(yard.db, yard.organizationId);
    const theirs = await askTool(clinic.db, clinic.organizationId);

    expect(mine.map((row) => row.title)).toContain(yard.lateTitle);
    expect(theirs.map((row) => row.title)).toContain(clinic.lateTitle);

    expect(mine.map((row) => row.status)).toContain('Op de planning');
    expect(theirs.map((row) => row.status)).toContain('Shinsatsu-chū');
    expect(mine.map((row) => row.status)).not.toContain('Shinsatsu-chū');

    expect(mine.every((row) => row.reason === 'window_passed')).toBe(true);
  });

  it('answers in the business’s own hours, not in UTC', async () => {
    // **The regression that a real model found and no test could.** A tool hands a model an
    // instant and the model is what renders it — so the business's own wall clock is rendered
    // here, in Postgres, rather than by giving a model a zone name and hoping it does date
    // arithmetic with daylight saving in it correctly.
    for (const business of [yard, clinic]) {
      const [row] = await askTool(business.db, business.organizationId);
      expect(row).toBeDefined();

      const expected = new Intl.DateTimeFormat('sv-SE', {
        timeZone: row.time_zone,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(row.scheduled_from));

      expect(row.starts_local).toBe(expected);
      // And it is genuinely not the UTC string, or this assertion would pass on a UTC tenant
      // while the defect it exists for sat untouched.
      expect(row.starts_local).not.toBe(row.scheduled_from.slice(0, 16).replace('T', ' '));
    }
  });

  it('returns nothing when handed another business’s id', async () => {
    // **The assertion this whole design exists for.** The argument came from a model; if it
    // were what narrowed, a made-up id would be somebody else's data. RLS is what narrows, so
    // the wrong id is simply an empty answer — and no error, because there is nothing here to
    // tell the caller that the other business exists.
    expect(await askTool(yard.db, clinic.organizationId)).toEqual([]);
    expect(await askTool(clinic.db, yard.organizationId)).toEqual([]);
  });

  it('answers a portal customer of the same business nothing at all', async () => {
    // **Same tool, same argument, same business, and a different answer** — which is the whole
    // demonstration: what a tool can see is decided by whose token it ran under, and by nothing
    // the tool or the loop did.
    //
    // Worth knowing *why* it is empty rather than narrowed, because it was not the expected
    // result and it is the more useful fact. A portal customer can read their own work items
    // (`work_items_select_external`) but has never been able to read `work_item_statuses` —
    // the business's internal board vocabulary is not theirs to see. This tool joins it, so the
    // join drops every row. **A tool's joins are part of what it discloses**, each joined
    // table's own policies apply, and a tool assembled from tables a caller can only partly
    // read answers less rather than answering wrongly.
    const token = await createPortalInvite(yard.db, { customerId: yard.customerId });
    const customer = anonClient();
    await claimPortalInvite(customer, { token });

    const asOperator = await askTool(yard.db, yard.organizationId);
    const asCustomer = await askTool(customer, yard.organizationId);

    expect(asOperator.map((row) => row.title)).toContain(yard.lateTitle);
    expect(asOperator.map((row) => row.title)).toContain('tool-yard not yours');
    expect(asCustomer).toEqual([]);
  });

  it('returns nothing to somebody who is a member of nothing', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `tool-stranger-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    await admin.auth.admin.createUser({ email, password, email_confirm: true });

    const stranger = anonClient();
    await stranger.auth.signInWithPassword({ email, password });

    expect(await askTool(stranger, yard.organizationId)).toEqual([]);
  });
});

describe('a run is recorded, and only its asker may read it', () => {
  async function record(business: Business, question: string, outcome = 'answered') {
    return business.db
      .from('agent_runs')
      .insert({
        organization_id: business.organizationId,
        conversation_id: await conversationFor(business),
        question,
        answer: outcome === 'answered' ? 'Two jobs ran past their window.' : '',
        outcome,
        detail: outcome === 'failed' ? 'the model declined' : null,
        tools: [{ tool: 'work_at_risk', arguments: {}, rows: 2, error: '' }],
        answered_by: 'test',
        created_by: business.userId,
      })
      .select('id')
      .single();
  }

  it('holds no foreign key to anything it read (I8)', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select t.relname as target
           from pg_constraint c
           join pg_class s on s.oid = c.conrelid
           join pg_class t on t.oid = c.confrelid
          where c.contype = 'f' and s.relname = 'agent_runs'`,
      );

      // The tenant it belongs to and the person who asked. Nothing to `work_items`, nothing to
      // `customers`, and nothing to a tool — the same absence `automation_runs` keeps against
      // its rule, so a record of what was asked cannot start reporting what is true today.
      // Plus the conversation it is filed under, which is structure rather than a record of
      // anything it read — the key carries the asker and the business, so a run cannot be filed
      // under somebody else's conversation.
      expect(rows.map((row) => row.target).sort()).toEqual(['agent_conversations', 'organizations', 'users']);
    } finally {
      await client.end();
    }
  });

  it('is invisible to a colleague in the same business', async () => {
    const { data: mine, error } = await record(yard, 'What is late today?');
    expect(error).toBeNull();

    // A second member of the same business, holding every capability the founder holds.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `tool-colleague-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    await admin.auth.admin.createUser({ email, password, email_confirm: true });

    const roleId = await createRole(yard.db, {
      organizationId: yard.organizationId,
      name: `colleague-${randomUUID().slice(0, 8)}`,
      capabilities: ['assistant.ask'],
    });
    await addMember(yard.db, {
      organizationId: yard.organizationId,
      email,
      displayName: 'Colleague',
      roleId,
    });

    const colleague = anonClient();
    await colleague.auth.signInWithPassword({ email, password });

    // They can ask their own questions and read their own answers. What they cannot do is read
    // somebody else's, because an answer holds whatever its asker could see.
    const { data: seen } = await colleague.from('agent_runs').select('id');
    expect(seen!.map((row) => row.id)).not.toContain(mine!.id);
    expect(seen).toEqual([]);
  });

  it('refuses a member whose role cannot ask', async () => {
    // A colleague rather than the founder demoted: `roles_last_manager` refuses to leave a
    // business with nobody able to manage roles, which is a different guarantee and not this
    // one's business.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `tool-mute-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created) throw createError;

    const roleId = await createRole(clinic.db, {
      organizationId: clinic.organizationId,
      name: `mute-${randomUUID().slice(0, 8)}`,
      capabilities: ['work_item.transition'],
    });
    await addMember(clinic.db, {
      organizationId: clinic.organizationId,
      email,
      displayName: 'Mute',
      roleId,
    });

    const mute = anonClient();
    await mute.auth.signInWithPassword({ email, password });

    // The conversation goes in over a direct connection: the claim here is that *this role* may
    // not record a run, and a mute member who could not even start a conversation would be a
    // refusal from an earlier door than the one under test.
    const admin2 = new Client({ connectionString: CONNECTION });
    await admin2.connect();
    let muteConversation: string;
    try {
      const { rows } = await admin2.query(
        `insert into public.agent_conversations (organization_id, created_by, title)
         values ($1, $2, 'Mute') returning id`,
        [clinic.organizationId, created.user.id],
      );
      muteConversation = rows[0].id;
    } finally {
      await admin2.end();
    }

    const { error } = await mute
      .from('agent_runs')
      .insert({
        organization_id: clinic.organizationId,
        conversation_id: muteConversation,
        question: 'What is late today?',
        answer: 'Something.',
        outcome: 'answered',
        tools: [],
        answered_by: 'test',
        created_by: created.user.id,
      })
      .select('id')
      .single();

    expect(error).not.toBeNull();
  });
});

/**
 * A write the model asked for and a person allowed.
 *
 * **The claim is that nothing happened until somebody said so, and that what then happened went
 * through the door every other write goes through.** `scheduleWorkItem` is called by
 * `decideOnAction`, under the deciding person's own session, so the capability check, the
 * overlap constraint and the buffer are all the ordinary ones — a suggestion is not a shortcut
 * past any of them.
 */
describe('a write is proposed, and a person decides (D34)', () => {
  /** What the loop would have written: a pending suggestion and nothing else. */
  async function proposeMove(business: Business, startsAt: string, endsAt: string) {
    const { data, error } = await business.db
      .from('agent_runs')
      .insert({
        organization_id: business.organizationId,
        conversation_id: await conversationFor(business),
        question: 'Anything I should move?',
        answer: 'That job overran. I would move it to tomorrow morning.',
        outcome: 'answered',
        tools: [{ tool: 'work_at_risk', arguments: {}, rows: 1, error: '' }],
        answered_by: 'test',
        created_by: business.userId,
        proposed_action: {
          name: 'propose_reschedule',
          arguments: {
            work_item_id: business.lateId,
            starts_at: startsAt,
            ends_at: endsAt,
            because: 'It ran past its window yesterday.',
          },
          because: 'It ran past its window yesterday.',
        },
        action_outcome: 'pending',
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    return data!.id;
  }

  function tomorrow(hour: number): string {
    const at = new Date();
    at.setUTCDate(at.getUTCDate() + 1);
    at.setUTCHours(hour, 0, 0, 0);
    return at.toISOString();
  }

  it('changes nothing until somebody presses the button', async () => {
    const before = await yard.db
      .from('work_items')
      .select('scheduled_during')
      .eq('id', yard.lateId)
      .single();

    await proposeMove(yard, tomorrow(9), tomorrow(10));

    const after = await yard.db
      .from('work_items')
      .select('scheduled_during')
      .eq('id', yard.lateId)
      .single();

    // The whole of the proposal contract in one assertion: the row that says what to do exists,
    // and the job has not moved.
    expect(after.data!.scheduled_during).toEqual(before.data!.scheduled_during);
  });

  it('writes through the domain layer when they do', async () => {
    const runId = await proposeMove(yard, tomorrow(11), tomorrow(12));

    const decided = await decideOnAction(yard.db, { runId, carryOut: true });
    expect(decided.actionOutcome).toBe('done');

    const { data } = await yard.db
      .from('work_items')
      .select('scheduled_during')
      .eq('id', yard.lateId)
      .single();

    // Postgres renders a range with a space rather than a T, so this compares the instant it
    // holds rather than the text it printed.
    const from = /^\["([^"]+)"/.exec(data!.scheduled_during as string)?.[1];
    expect(new Date(from!).toISOString()).toBe(tomorrow(11));
  });

  it('records the database’s own refusal rather than raising it', async () => {
    // Somebody else's job already has that resource for that window. `scheduleWorkItem` does not
    // look before it writes (I6) — the exclusion constraint decides, which is exactly what makes
    // a proposal safe to offer without searching for a free slot first.
    const { data: statusRow } = await yard.db
      .from('work_items')
      .select('status_id')
      .eq('id', yard.lateId)
      .single();

    const rival = await createWorkItem(yard.db, {
      organizationId: yard.organizationId,
      title: 'tool-yard rival',
      statusId: statusRow!.status_id,
    });
    await scheduleWorkItem(yard.db, {
      workItemId: rival,
      resourceIds: [yard.resourceId],
      startsAt: tomorrow(16),
      endsAt: tomorrow(17),
    });

    const clash = await proposeMove(yard, tomorrow(16), tomorrow(17));
    const decided = await decideOnAction(yard.db, { runId: clash, carryOut: true });

    // Recorded, not thrown, and in whoever's words refused it (I25).
    expect(decided.actionOutcome).toBe('failed');
    expect(decided.actionDetail).toBeTruthy();
  });

  it('is frozen once decided', async () => {
    const runId = await proposeMove(clinic, tomorrow(14), tomorrow(15));

    const declined = await decideOnAction(clinic.db, { runId, carryOut: false });
    expect(declined.actionOutcome).toBe('declined');

    // Deciding twice would be a job moved twice. Refused here for the message, and refused by
    // `agent_runs_update` regardless — its `using` clause stops matching the moment the outcome
    // is anything but pending.
    await expect(decideOnAction(clinic.db, { runId, carryOut: true })).rejects.toThrow();

    const direct = await clinic.db
      .from('agent_runs')
      .update({ action_outcome: 'done', action_taken_at: new Date().toISOString() })
      .eq('id', runId)
      .select('id');
    expect(direct.data).toEqual([]);
  });

  it('refuses a suggestion that names a job in words rather than by id', async () => {
    // Watched happening with a small local model: it proposed a move and put "ID of the Fenwick
    // Road excavator hire job in the system" where the id goes, having called no tool at all.
    // The write was never going to happen; what this buys is a sentence somebody can act on
    // instead of a failed cast.
    const { data } = await yard.db
      .from('agent_runs')
      .insert({
        organization_id: yard.organizationId,
        conversation_id: await conversationFor(yard),
        question: 'Move the excavator job.',
        answer: 'I would move it to tomorrow.',
        outcome: 'answered',
        tools: [],
        answered_by: 'test',
        created_by: yard.userId,
        proposed_action: {
          name: 'propose_reschedule',
          because: 'It overran.',
          arguments: {
            work_item_id: 'the Fenwick Road excavator hire job',
            starts_at: tomorrow(9),
            ends_at: tomorrow(10),
            because: 'It overran.',
          },
        },
        action_outcome: 'pending',
      })
      .select('id')
      .single();

    const decided = await decideOnAction(yard.db, { runId: data!.id, carryOut: true });

    expect(decided.actionOutcome).toBe('failed');
    expect(decided.actionDetail).toContain('does not name a real job');
  });

  it('knows only the actions this side can carry out', async () => {
    // The two runtimes are allowed to disagree, and the disagreement must fail closed: the
    // whitelist here is the authority, and a name it does not hold is refused rather than
    // dispatched.
    expect(executorFor('propose_reschedule')).not.toBeNull();
    expect(executorFor('delete_everything')).toBeNull();
  });

  it('judges a suggestion before it is ever offered as a button', async () => {
    // **The same checks the executor runs, run at record time.** A suggestion that could only
    // ever fail should not reach somebody as a control they can press — watched with a small
    // local model naming a job in words where the id goes.
    const good = {
      work_item_id: yard.lateId,
      starts_at: '2026-09-04T09:00:00+10:00',
      ends_at: '2026-09-04T10:00:00+10:00',
      because: 'It overran.',
    };
    expect(reasonActionCannotRun('propose_reschedule', good)).toBeNull();

    expect(
      reasonActionCannotRun('propose_reschedule', {
        ...good,
        work_item_id: 'the Fenwick Road excavator hire job',
      }),
    ).toContain('does not name a real job');

    expect(
      reasonActionCannotRun('propose_reschedule', { ...good, starts_at: 'tomorrow morning' }),
    ).toContain('not a time');

    // Ends before it starts: refused here rather than by the domain function, so the sentence
    // arrives while somebody is still reading the suggestion.
    expect(
      reasonActionCannotRun('propose_reschedule', {
        ...good,
        ends_at: '2026-09-04T08:00:00+10:00',
      }),
    ).toContain('ends before it starts');

    expect(reasonActionCannotRun('delete_everything', good)).toContain('cannot carry out');
  });

  it('shows the week ahead in the business’s own hours, and computes no availability', async () => {
    const { data, error } = await yard.db.rpc('schedule_ahead', {
      p_organization_id: yard.organizationId,
      p_days: 7,
    });
    expect(error).toBeNull();

    const booked = (data ?? []) as { title: string; starts_local: string; time_zone: string }[];
    // The overran job ended yesterday, so the week ahead does not carry it; what it carries is
    // work that has not finished yet.
    expect(booked.every((row) => row.time_zone === 'America/New_York')).toBe(true);
    for (const row of booked) {
      expect(row.starts_local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }

    // **It answers what is taken, never what is free.** There is one availability calculation
    // in this platform and it is not here (I5) — a tool that returned free windows would be a
    // second one, in a second runtime, which is precisely what D30 refused for automations.
    expect(Object.keys(booked[0] ?? {})).not.toContain('free');
  });
});

/**
 * The other question M8's criterion names, and the definition it shares with a screen.
 *
 * **The interesting assertion is the third one.** Almost everything a business remembers about a
 * customer happened to a *job*, and one action names the customer only in its payload — so a
 * naive "events where entity_id = the customer" answers wrongly in two directions. That
 * resolution now lives in `customer_activity` and is read by both this tool and the customer
 * timeline, which is the extract-then-call-twice rule arriving at a view.
 */
describe('customers nobody has recorded anything about (D34)', () => {
  it('counts what happened to a customer’s jobs as theirs', async () => {
    // **The sharp one, and the reason the definition moved.** Almost everything a business
    // remembers about a customer happened to a *job*. `yard.customerId` has had nothing written
    // against their own row since they were added, and plenty written against their work — so a
    // naive "events where entity_id = the customer" would report them as untouched.
    const quiet = await createCustomer(yard.db, {
      organizationId: yard.organizationId,
      name: 'tool-yard quiet',
    });

    const { data: theirs } = await yard.db
      .from('customer_activity')
      .select('action')
      .eq('organization_id', yard.organizationId)
      .eq('customer_id', yard.customerId);

    const actions = (theirs ?? []).map((row) => row.action);
    expect(actions).toContain('work_item.scheduled');

    // And somebody nothing has happened to has exactly the one event that added them.
    const { data: nothing } = await yard.db
      .from('customer_activity')
      .select('action')
      .eq('organization_id', yard.organizationId)
      .eq('customer_id', quiet);

    expect((nothing ?? []).map((row) => row.action)).toEqual(['customer.created']);
  });

  it('lists everybody when no silence is long enough to be excused', async () => {
    const all = await askQuiet(yard.db, yard.organizationId, 0);
    const named = all.map((row) => row.customer_id);

    expect(named).toContain(yard.customerId);
    // Each one carries when something last happened, which is what makes the answer checkable
    // against the customer's own screen.
    expect(all.every((row) => row.last_activity !== null)).toBe(true);
  });

  it('is silent about a business that is not yours', async () => {
    // The same claim the first tool makes, and it has to be made again: the argument is not
    // what narrows, on every tool, not just the one that was written first.
    expect(await askQuiet(yard.db, clinic.organizationId, 0)).toEqual([]);
    expect(await askQuiet(clinic.db, yard.organizationId, 0)).toEqual([]);
  });

  it('takes the number of days from its caller rather than from the platform', async () => {
    // A business that chases weekly and one that chases quarterly are both ordinary, and a
    // window nothing is older than empties the list. A constant in the function would be the
    // hardcoding this repository refuses everywhere else.
    expect(await askQuiet(yard.db, yard.organizationId, 3650)).toEqual([]);
    expect((await askQuiet(yard.db, yard.organizationId, 0)).length).toBeGreaterThan(0);
  });

  it('reads the same definition the customer’s own timeline reads', async () => {
    // Both callers go through `customer_activity`, so an operator can always click into the
    // customer and see exactly why their name came back. The view is `security_invoker`, which
    // is what keeps that true rather than making it a second, wider read.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select c.reloptions
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'customer_activity'`,
      );
      // Read from the catalogue rather than from the definition: dropping this flag is one
      // word, nothing else about the view would look different, and every caller would
      // silently start reading every tenant.
      expect(rows[0].reloptions).toContain('security_invoker=true');
    } finally {
      await client.end();
    }
  });
});
