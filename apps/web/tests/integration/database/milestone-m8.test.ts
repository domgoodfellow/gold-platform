import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  DraftedConfiguration,
  DraftingProvider,
  DraftingRequest,
} from '@/lib/adapters/drafting';
import { configureBusiness, type BusinessShape } from '@/lib/domain/configuration/configure';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { foundBusiness } from '@/tests/support/founding';

/**
 * THE M8 MILESTONE TEST — the second of its two criteria.
 *
 * This milestone's second half was defined as one demonstration:
 *
 *   > can describe a business in prose and receive a proposed configuration, work item types,
 *   > statuses, fields and price book, which a human reviews and applies.
 *
 * **The inversion this milestone brings is that it is proved by what has *not* happened.** M1 ran
 * byte-identical input through one database and proved neither business could see the other. M2
 * ran identical input twice and proved it landed on the same instants. M3 ran maximally different
 * input through identical code. M4 ran half of itself as somebody who is a member of nothing. M5
 * ran as somebody who is a member of *none* of them. M6 was proved by a person doing nothing.
 * **M8 is proved by a machine having done nothing**: prose goes in, a whole configuration comes
 * back, and the assertion in the middle of this file is that the business is still completely
 * empty. Not one status, not one price, not one hour. Everything that eventually exists is
 * written by a person, afterwards, through `configureBusiness` — the same function M3 drives and
 * the same policies a hand-typed write would meet.
 *
 * **The review is exercised rather than assumed.** Between proposing and applying, this file
 * changes a word — because a proposal a person can only accept or reject is an approval, and the one-creation-path rule's
 * argument for the self-serve door is that an *edited* proposal beats a form filled in by somebody
 * guessing. What lands in the database is the edited word, and the drafted one appears nowhere.
 *
 * **The drafting itself is a fixed provider, and that is correct rather than a compromise.** The
 * claim this milestone makes is about the path from a description to a configured business —
 * where the proposal lives, what may touch it, and who writes. A test that called a real provider
 * would be slow, chargeable, non-deterministic, and would be asserting somebody else's judgement.
 * The draft-then-apply rule (ADR-039) records that the model holds no tool and no database handle; it is
 * `proposals.test.ts` that reads the adapter's imports and fails the gate on one.
 *
 * **What this deliberately does not claim.** M8's *first* criterion — asking the system questions
 * through domain tools — is not built and is not exercised here. It waits for M7's aggregate
 * layer, and `roadmap.md`'s *Order of work* says so. This file proves the half that exists.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// `apps/web` itself — there is no `src/` for it to nest inside.
const SRC = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Two businesses that share no word, no number, no stage, no role and no currency.
 *
 * A chimney sweep in Tallinn and a dive school in Cebu. One works alone in other people's
 * houses and prices by the visit; the other takes groups into the sea and prices by the person.
 * Nothing about either is a platform default, and nothing in the code below can tell them apart.
 */
const SWEEP = {
  identity: { name: 'Korstnapühkija Tallinn', currency: 'EUR', timezone: 'Europe/Tallinn' },
  description:
    'I sweep chimneys around Tallinn on my own. Someone rings, I put them in the book, I go out and do the sweep, then I write up a certificate and send it. I charge per visit, and more for a stove than an open fire. I work Monday to Friday mornings only.',
  shape: {
    typeName: 'Pühkimine',
    schedulable: true,
    statuses: ['Raamatus', 'Tehtud', 'Tunnistus saadetud'],
    transitions: [
      [0, 1],
      [1, 2],
    ],
    fields: {
      work_item: [{ key: 'korsten', label: 'Korstna tüüp', kind: 'text', required: true }],
    },
    prices: [{ name: 'Lahtise tule pühkimine', unit: 'visiit', amountMinor: 6500 }],
    hours: [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' }],
    roles: [{ name: 'Abiline', capabilities: ['work_item.transition'] }],
    automations: [],
  } satisfies BusinessShape,
} as const;

const DIVE = {
  identity: { name: 'Cebu Blue Water Divers', currency: 'PHP', timezone: 'Asia/Manila' },
  description:
    'We run diving courses out of Moalboal. People enquire, we confirm a boat, they turn up for the classroom part, then the open water dives, then we certify them. Price is per diver per course. Boats go out every day of the week.',
  shape: {
    typeName: 'Course',
    schedulable: true,
    statuses: ['Enquiry', 'Boat confirmed', 'Classroom', 'Open water', 'Certified'],
    transitions: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
    fields: {
      customer: [{ key: 'brevet', label: 'Existing certification', kind: 'text', required: false }],
    },
    prices: [{ name: 'Open Water course', unit: 'diver', amountMinor: 1850000 }],
    hours: [
      { dayOfWeek: 6, opensAt: '06:00', closesAt: '18:00' },
      { dayOfWeek: 7, opensAt: '06:00', closesAt: '18:00' },
    ],
    roles: [{ name: 'Divemaster', capabilities: ['work_item.transition', 'work_item.schedule'] }],
    automations: [],
  } satisfies BusinessShape,
} as const;

/**
 * A provider that answers from a fixed table, standing in for the one that thinks.
 *
 * It keys off the description because the two businesses have to get their own shapes back —
 * which is the *only* thing about drafting this file models. It asks one question and returns one
 * gap, so the flow that carries questions to a person is exercised rather than skipped.
 */
const FIXED_PROVIDER: DraftingProvider = {
  name: 'Fixed provider (test)',
  async draft(input: DraftingRequest): Promise<DraftedConfiguration | null> {
    const known = [SWEEP, DIVE].find((business) => business.description === input.description);
    if (!known) return null;

    return {
      shape: known.shape,
      gaps: [{ field: 'prices', question: 'Is there anything else you charge for?' }],
    };
  },
};

vi.mock('@/lib/adapters/drafting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/adapters/drafting')>()),
  draftingProvider: async () => FIXED_PROVIDER,
}));

// Imported after the mock is declared, because these are what reach the adapter.
const {
  applyConfigurationProposal,
  currentConfigurationProposal,
  proposeConfiguration,
  reviseConfigurationProposal,
} = await import('@/lib/domain/configuration/proposals');

type Stood = {
  db: SupabaseClient;
  organizationId: string;
  /** The word this file changed during the review, which is not the word that was drafted. */
  editedStatus: string;
};

let sweep: Stood;
let dive: Stood;

/**
 * One business, from an empty organization to a configured one, with the assertions that matter
 * taken *between* the steps rather than at the end.
 */
async function standUp(business: typeof SWEEP | typeof DIVE, label: string): Promise<Stood> {
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
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  // GOLD brings the business into existence and hands it over. It is empty, and the emptiness is
  // the product — there is nothing here for a proposal to have to work around.
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: business.identity.name,
    currency: business.identity.currency,
    timezone: business.identity.timezone,
  });

  const rolesAtFounding = (await listRoles(db, { organizationId })).length;

  // Prose in.
  await proposeConfiguration(db, { organizationId, description: business.description });

  // **The assertion this milestone turns on.** A whole configuration has been proposed and the
  // business is exactly as empty as it was a moment ago. The AI proposed configuration; it did
  // not become configuration, and there is no path by which it could have — it holds no database
  // handle at all.
  expect(await listWorkItemTypes(db, { organizationId })).toEqual([]);
  expect(await listPriceBookItems(db, { organizationId })).toEqual([]);
  expect(await listOperatingHours(db, { organizationId })).toEqual([]);
  expect(await listRoles(db, { organizationId })).toHaveLength(rolesAtFounding);

  const proposal = await currentConfigurationProposal(db, { organizationId });
  expect(proposal).not.toBeNull();
  expect(proposal!.outcome).toBe('draft');
  expect(proposal!.description).toBe(business.description);
  expect(proposal!.gaps).toHaveLength(1);

  // **A human reviews**, which here means changes something. The last stage gets a word the
  // drafting never produced, and that word is what has to end up in the database.
  const editedStatus = `${business.shape.statuses.at(-1)} ✓`;
  await reviseConfigurationProposal(db, {
    organizationId,
    proposalId: proposal!.id,
    shape: {
      ...business.shape,
      statuses: [...business.shape.statuses.slice(0, -1), editedStatus],
    },
  });

  // **…and applies.** Through `configureBusiness`, under this person's own session, with every
  // write meeting the policy it would have met had it been typed in by hand.
  const applied = await applyConfigurationProposal(db, { organizationId, proposalId: proposal!.id });
  expect(applied.outcome).toBe('applied');
  expect(applied.detail).toBeNull();

  return { db, organizationId, editedStatus };
}

describe('M8 — a business describes itself and is configured from the description', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    sweep = await standUp(SWEEP, 'm8-sweep');
    dive = await standUp(DIVE, 'm8-dive');
  }, 60_000);

  it('configured each business in its own words', async () => {
    for (const [stood, business] of [
      [sweep, SWEEP],
      [dive, DIVE],
    ] as const) {
      const types = await listWorkItemTypes(stood.db, { organizationId: stood.organizationId });
      expect(types.map((type) => type.name)).toEqual([business.shape.typeName]);

      const statuses = await listWorkItemStatuses(stood.db, {
        organizationId: stood.organizationId,
        typeId: types[0].id,
      });
      // Every drafted stage but the last, then the word this file substituted during the review.
      expect(statuses.map((status) => status.name)).toEqual([
        ...business.shape.statuses.slice(0, -1),
        stood.editedStatus,
      ]);

      const prices = await listPriceBookItems(stood.db, {
        organizationId: stood.organizationId,
      });
      expect(prices.map((item) => item.name)).toEqual(
        business.shape.prices.map((price) => price.name),
      );
      // The currency is the organization's, snapshotted onto the amount. Nothing in the
      // proposal asserted it and nothing could.
      expect(prices.every((item) => item.currency === business.identity.currency)).toBe(true);

      const hours = await listOperatingHours(stood.db, {
        organizationId: stood.organizationId,
      });
      expect(hours.map((entry) => entry.dayOfWeek)).toEqual(
        business.shape.hours.map((entry) => entry.dayOfWeek),
      );
    }
  });

  it('kept the word that was reviewed away and the word that was drafted out', async () => {
    // The sharpest thing the review can be asked to prove: a proposal is not what gets applied,
    // the reviewed version is. If the edit were being ignored, everything above would still pass
    // for a business whose last stage happened to be right.
    const types = await listWorkItemTypes(sweep.db, { organizationId: sweep.organizationId });
    const statuses = await listWorkItemStatuses(sweep.db, {
      organizationId: sweep.organizationId,
      typeId: types[0].id,
    });

    expect(statuses.map((status) => status.name)).toContain(sweep.editedStatus);
    expect(statuses.map((status) => status.name)).not.toContain(SWEEP.shape.statuses.at(-1));
  });

  it('let neither business observe the other', async () => {
    const seenByDive = await listWorkItemTypes(dive.db, {
      organizationId: sweep.organizationId,
    });
    expect(seenByDive).toEqual([]);

    const seenBySweep = await listPriceBookItems(sweep.db, {
      organizationId: dive.organizationId,
    });
    expect(seenBySweep).toEqual([]);
  });

  it('did it through code that names neither of them', () => {
    // **The structural claim, and it spans both halves of the path.** M3 makes this about
    // `configureBusiness` alone: one function, no branch on which business it is holding. M8 has
    // a second place a business's specifics could have been smuggled in — the thing that drafts —
    // and a drafting capability that knew what a chimney sweep was would be the per-client app
    // studio `docs/product.md` refuses, arriving one layer further out than M3 was watching.
    const drafting = join(SRC, 'lib', 'adapters', 'drafting');
    const sources = [
      configureBusiness.toString(),
      ...readdirSync(drafting)
        .filter((entry) => /\.ts$/.test(entry))
        .map((entry) => readFileSync(join(drafting, entry), 'utf8')),
    ];

    // Guards the rest against passing because a source is empty — the precaution
    // `milestone-m3.test.ts` and `schema-conformance.test.ts` both take before asserting over
    // something they read.
    expect(sources).toHaveLength(4);
    for (const source of sources) expect(source.length).toBeGreaterThan(500);
    expect(sources[0]).toContain('createWorkItemStatus');
    expect(sources.join('\n')).toContain('additionalProperties');

    for (const source of sources) {
      for (const business of [SWEEP, DIVE]) {
        expect(source).not.toContain(business.identity.name);
        expect(source).not.toContain(business.identity.timezone);
        expect(source).not.toContain(`'${business.identity.currency}'`);
        expect(source).not.toContain(business.shape.typeName);
        for (const status of business.shape.statuses) expect(source).not.toContain(status);
        for (const role of business.shape.roles) expect(source).not.toContain(role.name);
        for (const price of business.shape.prices) expect(source).not.toContain(price.name);
        for (const fields of Object.values(business.shape.fields)) {
          for (const field of fields) expect(source).not.toContain(field.key);
        }
      }
    }
  });
});
