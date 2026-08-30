import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { configureBusiness, type BusinessShape } from '@/lib/domain/onboarding/configure';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { addPricedLine, listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import {
  allowedNextStatusIds,
  changeWorkItemStatus,
  listWorkItemTransitions,
} from '@/lib/domain/work-items/transitions';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';

/**
 * THE M3 MILESTONE TEST.
 *
 * `roadmap.md` describes M3 as one demonstration:
 *
 *   > a new business can be stood up entirely through configuration — modules, roles, fields,
 *   > statuses, forms, terminology, pricing rules, scheduling rules — with no migration and
 *   > no deploy. The test is literally: configure a second business shape without a pull
 *   > request.
 *
 * **The structure of this file is the assertion, and the `expect` calls are secondary.**
 * There is exactly one function that configures a business, it is
 * `configureBusiness` in `lib/domain/onboarding/configure.ts`, and it performs a fixed
 * sequence of domain calls taking every word, number, status, field, order, currency, zone
 * and price as *data*. It is called twice below, with two business shapes that share nothing:
 * an equipment hire yard in Amsterdam trading in euro, and a clinic in Tokyo trading in yen.
 * If either shape had needed a branch — a different call, an extra argument, a special case —
 * that function could not exist, and its existence is what "without a pull request" means.
 *
 * **It used to live in this file, and moving it strengthened the claim rather than relocating
 * it.** A `configure` helper inside a test proves that a test can stand up two businesses; a
 * domain function with a second caller proves the platform can. The second caller is the AI
 * onboarding flow D29 makes self-serve signup conditional on, and `BusinessShape` is the type
 * a proposal from it arrives as. The local `configure` below is now only the *evidence* — one
 * customer, one job, one quote — that these assertions read.
 *
 * That inverts the two milestones before it deliberately. M1 ran **byte-identical** input
 * through one database and proved the two businesses could not see each other. M2 ran
 * **identical** input twice and proved it landed on the same instants. M3 runs **maximally
 * different** input through identical code.
 *
 * **Nothing here touches SQL**, on the same reasoning `milestone-m2.test.ts` gives: "with no
 * migration" is a claim about the path, so the path is what is exercised. The only privileged
 * client mints the two accounts, exactly as `setup.ts` does everywhere.
 *
 * **What this deliberately does not claim.** M3's criterion sentence lists modules and
 * dashboard configuration; neither exists, and neither is exercised here. See the roadmap
 * entry, which records why: a module needs two independent pieces of evidence with one from a
 * shipped system, and there are no modules to enable. This file proves the claim that can be
 * proved today — that the *shape* of a business is data — and does not pretend about the rest.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * A business shape, plus the evidence this test needs to assert against it.
 *
 * `BusinessShape` itself now lives in `lib/domain/onboarding/configure.ts` — the structural
 * claim this file makes is about a function with no branch in it, and that function is real
 * code with a second caller rather than a fixture. What is added here is the one customer, one
 * job and one quote the assertions read: those are evidence, not configuration, and a business
 * that has just been stood up has neither.
 */
type Evidence = {
  shape: BusinessShape;
  customerName: string;
  customerCustom: Record<string, string>;
  jobTitle: string;
  jobCustom: Record<string, string>;
  /** What that job is quoted: an index into `shape.prices`, and how many. */
  quote: { price: number; quantity: number }[];
};

/** An equipment hire yard. Four statuses, a linear-with-a-loop lifecycle, euro, Amsterdam. */
const HIRE: Evidence = {
  shape: {
    name: 'Meridian Plant Hire',
    timezone: 'Europe/Amsterdam',
    currency: 'EUR',
    typeName: 'Hire',
    statuses: ['Reserved', 'Out', 'Returned', 'Inspected'],
    transitions: [
      [0, 1],
      [1, 2],
      [2, 3],
      // Back to Out: a machine that failed inspection goes out again. A loop, which the clinic
      // below does not have, and which nothing in the platform knows is unusual.
      [3, 1],
    ],
    // Listed in the order this business wants its form rendered, which is deliberately not
    // alphabetical and not the order a platform would have guessed.
    fields: {
      work_item: [
        { key: 'deposit_taken', label: 'Deposit taken', kind: 'boolean', required: false },
        { key: 'site_contact', label: 'Site contact', kind: 'text', required: true },
      ],
      customer: [
        { key: 'account_code', label: 'Account code', kind: 'text', required: false },
      ],
    },
    prices: [
      { name: 'Excavator', unit: 'day', amountMinor: 18000 },
      { name: 'Delivery', unit: 'trip', amountMinor: 7500 },
    ],
    hours: [
      { dayOfWeek: 1, opensAt: '07:00', closesAt: '17:00' },
      { dayOfWeek: 6, opensAt: '08:00', closesAt: '12:00' },
    ],
    roles: [
      {
        name: 'Yard Hand',
        capabilities: ['work_item.create', 'work_item.transition', 'work_item.price'],
      },
    ],
    founderDisplayName: 'Founder',
  },
  customerName: 'Voskuil Groundworks',
  customerCustom: { account_code: 'VOS-114' },
  jobTitle: '8-tonne excavator, Zaandam',
  jobCustom: { site_contact: 'Ruud', deposit_taken: 'on' },
  quote: [
    { price: 0, quantity: 3 },
    { price: 1, quantity: 1 },
  ],
};

/** A clinic. Three statuses, no loop, yen — which has no minor unit at all — and Tokyo. */
const CLINIC: Evidence = {
  shape: {
    name: 'Kessler Klinik',
    timezone: 'Asia/Tokyo',
    currency: 'JPY',
    typeName: 'Consultation',
    statuses: ['Booked', 'Seen', 'Billed'],
    transitions: [
      [0, 1],
      [1, 2],
    ],
    fields: {
      work_item: [
        { key: 'room', label: 'Room', kind: 'text', required: true },
        { key: 'referral_number', label: 'Referral number', kind: 'number', required: false },
      ],
      customer: [
        { key: 'insurer', label: 'Insurer', kind: 'text', required: true },
        { key: 'consent_on_file', label: 'Consent on file', kind: 'boolean', required: false },
      ],
    },
    prices: [
      // Yen has no minor unit: 12000 here is twelve thousand yen, not one hundred and twenty.
      { name: 'Consultation', unit: 'appointment', amountMinor: 12000 },
      { name: 'Home visit', unit: 'visit', amountMinor: 30000 },
    ],
    // Says nothing about when it is open, which is a valid answer and means always open. No
    // seeded week exists to contradict it.
    hours: [],
    roles: [
      {
        name: 'Receptionist',
        capabilities: ['customer.create', 'work_item.create', 'work_item.transition'],
      },
    ],
    founderDisplayName: 'Founder',
  },
  customerName: 'Haruki Tanabe',
  customerCustom: { insurer: 'Kyosai', consent_on_file: 'on' },
  jobTitle: 'Initial consultation',
  jobCustom: { room: '2B', referral_number: '88104' },
  quote: [
    { price: 0, quantity: 1 },
    { price: 1, quantity: 1 },
  ],
};

type StoodUp = {
  db: SupabaseClient;
  organizationId: string;
  typeId: string;
  statusIds: string[];
  jobId: string;
  evidence: Evidence;
};

async function signedInUser(label: string): Promise<SupabaseClient> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

/**
 * Stand up a whole business from a shape.
 *
 * **This function is the milestone.** Read it as a list of the things a business can differ
 * by, and notice that not one line asks *which* business this is. There is no `if
 * (shape.name === …)`, no lookup table of vertical defaults, and no branch on currency,
 * status count or field kind — the clinic's three statuses and the hire yard's four are the
 * same loop running a different number of times.
 */
async function configure(db: SupabaseClient, evidence: Evidence): Promise<StoodUp> {
  // The whole of the configuration, in one call, with no branch anywhere in it. Everything
  // below this line is the evidence the assertions read — one customer, one job, one quote —
  // and none of it is part of standing a business up.
  const { organizationId, typeId, statusIds } = await configureBusiness(db, evidence.shape);

  await createCustomer(db, {
    organizationId,
    name: evidence.customerName,
    custom: evidence.customerCustom,
  });

  const jobId = await createWorkItem(db, {
    organizationId,
    title: evidence.jobTitle,
    statusId: statusIds[0],
    custom: evidence.jobCustom,
  });

  const catalogue = await listPriceBookItems(db, { organizationId });
  for (const line of evidence.quote) {
    const wanted = evidence.shape.prices[line.price].name;
    const item = catalogue.find((candidate) => candidate.name === wanted)!;
    await addPricedLine(db, {
      workItemId: jobId,
      priceBookItemId: item.id,
      quantity: line.quantity,
    });
  }

  return { db, organizationId, typeId, statusIds, jobId, evidence };
}

let hire: StoodUp;
let clinic: StoodUp;

describe('M3 — a second business shape, without a pull request', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    // Two shapes, one function, one database, no migration between them.
    hire = await configure(await signedInUser('m3-hire'), HIRE);
    clinic = await configure(await signedInUser('m3-clinic'), CLINIC);
  });

  it('gives each business its own vocabulary for the work it does', async () => {
    const hireTypes = await listWorkItemTypes(hire.db, { organizationId: hire.organizationId });
    const clinicTypes = await listWorkItemTypes(clinic.db, {
      organizationId: clinic.organizationId,
    });

    expect(hireTypes.map((type) => type.name)).toEqual(['Hire']);
    expect(clinicTypes.map((type) => type.name)).toEqual(['Consultation']);
  });

  it('gives each business a lifecycle of its own length and its own shape', async () => {
    const hireStatuses = await listWorkItemStatuses(hire.db, {
      organizationId: hire.organizationId,
      typeId: hire.typeId,
    });
    const clinicStatuses = await listWorkItemStatuses(clinic.db, {
      organizationId: clinic.organizationId,
      typeId: clinic.typeId,
    });

    expect(hireStatuses.map((s) => s.name)).toEqual(['Reserved', 'Out', 'Returned', 'Inspected']);
    expect(clinicStatuses.map((s) => s.name)).toEqual(['Booked', 'Seen', 'Billed']);

    const hireMoves = await listWorkItemTransitions(hire.db, {
      organizationId: hire.organizationId,
      typeId: hire.typeId,
    });
    const clinicMoves = await listWorkItemTransitions(clinic.db, {
      organizationId: clinic.organizationId,
      typeId: clinic.typeId,
    });

    // The hire yard's board loops — a machine that fails inspection goes out again. The
    // clinic's does not. Nothing in the platform holds an opinion about either.
    expect(hireMoves).toHaveLength(4);
    expect(clinicMoves).toHaveLength(2);
    expect(allowedNextStatusIds(hireMoves, hire.statusIds[3])).toEqual([hire.statusIds[1]]);
    expect(allowedNextStatusIds(clinicMoves, clinic.statusIds[2])).toEqual([]);
  });

  it('walks each job through its own lifecycle', async () => {
    await changeWorkItemStatus(hire.db, {
      workItemId: hire.jobId,
      toStatusId: hire.statusIds[1],
    });
    await changeWorkItemStatus(clinic.db, {
      workItemId: clinic.jobId,
      toStatusId: clinic.statusIds[1],
    });

    const [hireJob] = await listWorkItems(hire.db, { organizationId: hire.organizationId });
    const [clinicJob] = await listWorkItems(clinic.db, {
      organizationId: clinic.organizationId,
    });

    expect(hireJob.status.label).toBe('Out');
    expect(clinicJob.status.label).toBe('Seen');

    // And each board refuses the other's move, because a transition belongs to one tenant's
    // type (I13). The clinic has no Billed → anywhere, so nothing follows it.
    await expect(
      changeWorkItemStatus(clinic.db, {
        workItemId: clinic.jobId,
        toStatusId: clinic.statusIds[0],
      }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });
  });

  it('gives each business its own form, in its own order', async () => {
    const hireForm = await listFieldDefinitions(hire.db, {
      organizationId: hire.organizationId,
      entityType: 'work_item',
    });
    const clinicForm = await listFieldDefinitions(clinic.db, {
      organizationId: clinic.organizationId,
      entityType: 'work_item',
    });

    // Each business declared its own order in its own shape, and each got it. That is what
    // this milestone claims — the form is data — and it is deliberately not the same claim as
    // "position is assigned explicitly rather than falling out of creation order", which
    // `field-forms.test.ts` "renders in the order the tenant chose, not the order they were
    // defined" owns and proves against a form that is rearranged after the fact.
    expect(hireForm.map((f) => f.key)).toEqual(['deposit_taken', 'site_contact']);
    expect(clinicForm.map((f) => f.key)).toEqual(['room', 'referral_number']);

    // Different kinds, and each stored as its own type rather than as a string.
    const [clinicJob] = await listWorkItems(clinic.db, {
      organizationId: clinic.organizationId,
    });
    expect(clinicJob.custom.referral_number).toBe(88104);
    expect(clinicJob.custom.room).toBe('2B');

    const [hireJob] = await listWorkItems(hire.db, { organizationId: hire.organizationId });
    expect(hireJob.custom.deposit_taken).toBe(true);
    expect(hireJob.custom.site_contact).toBe('Ruud');
  });

  it('refuses each business the other’s fields (I17)', async () => {
    // The clinic has no `site_contact` and the registry is per tenant, so this is not a
    // missing column — it is one business's vocabulary being meaningless in another.
    await expect(
      createWorkItem(clinic.db, {
        organizationId: clinic.organizationId,
        title: 'Borrowed vocabulary',
        statusId: clinic.statusIds[0],
        custom: { room: '3A', site_contact: 'Ruud' },
      }),
    ).rejects.toMatchObject({ code: 'fields.unknown' });
  });

  it('lets one business say nothing about its hours and the other be specific', async () => {
    const hireHours = await listOperatingHours(hire.db, {
      organizationId: hire.organizationId,
    });
    const clinicHours = await listOperatingHours(clinic.db, {
      organizationId: clinic.organizationId,
    });

    expect(hireHours.map((h) => h.dayOfWeek)).toEqual([1, 6]);
    // Nothing seeded a working week for the clinic, which is the whole point: a business that
    // has said nothing is always open, and no Monday-to-Friday exists to contradict it.
    expect(clinicHours).toEqual([]);
  });

  it('prices each business in its own money, through the one calculation (I4)', async () => {
    const hirePrice = priceWorkItem(
      await listPricedLines(hire.db, {
        organizationId: hire.organizationId,
        workItemId: hire.jobId,
      }),
    );
    const clinicPrice = priceWorkItem(
      await listPricedLines(clinic.db, {
        organizationId: clinic.organizationId,
        workItemId: clinic.jobId,
      }),
    );

    // 18000 × 3 + 7500. Euro, two decimal places.
    expect(hirePrice).toEqual({ totalMinor: 61500, currency: 'EUR' });
    expect(formatMoney(hirePrice!.totalMinor, hirePrice!.currency)).toContain('615.00');

    // 12000 + 30000. Yen has no minor unit, so the same kind of integer means a different
    // kind of amount, and the formatter takes that from the currency rather than assuming.
    expect(clinicPrice).toEqual({ totalMinor: 42000, currency: 'JPY' });
    expect(formatMoney(clinicPrice!.totalMinor, clinicPrice!.currency)).not.toContain('.');
  });

  it('keeps each business’s configuration entirely its own', async () => {
    // The kernel guarantee, re-asserted at the level M3 operates on: configuration is data,
    // and one tenant's data is invisible to the other however differently shaped it is.
    const seenByHire = await listPriceBookItems(hire.db, {
      organizationId: clinic.organizationId,
    });
    const seenByClinic = await listWorkItemTypes(clinic.db, {
      organizationId: hire.organizationId,
    });
    const customers = await listCustomers(hire.db, { organizationId: clinic.organizationId });

    expect(seenByHire).toEqual([]);
    expect(seenByClinic).toEqual([]);
    expect(customers).toEqual([]);
  });

  it('stood both up with the same code and no migration between them', () => {
    // The assertion the rest of the file exists to make legible, and it now reads the domain
    // layer rather than this file. `configureBusiness` ran twice, over two shapes that share
    // no word, no number, no status, no field, no currency and no zone — and it contains no
    // branch on which of them it is holding. That is the milestone: standing up a business is
    // data, not a pull request. Reading real code rather than a test helper is what makes it a
    // claim about the platform instead of a claim about this file.
    const source = configureBusiness.toString();

    // Guards the rest of this test against passing because `source` is empty or minified —
    // the same precaution schema-conformance takes before asserting over a catalog.
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain('createWorkItemStatus');
    expect(source).toContain('createPriceBookItem');

    const shapes = [HIRE.shape, CLINIC.shape];
    for (const shape of shapes) {
      expect(source).not.toContain(shape.name);
      expect(source).not.toContain(shape.typeName);
      expect(source).not.toContain(`'${shape.currency}'`);
      expect(source).not.toContain(shape.timezone);
      for (const status of shape.statuses) expect(source).not.toContain(status);
      for (const role of shape.roles) expect(source).not.toContain(role.name);
      for (const price of shape.prices) expect(source).not.toContain(price.name);
      for (const fields of Object.values(shape.fields)) {
        for (const field of fields) expect(source).not.toContain(field.key);
      }
    }
  });
});
