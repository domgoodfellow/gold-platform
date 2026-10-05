import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FormDefinition } from '@gold/schemas';
import { beginBooking, bookSlot, bookableSlots, type BookableType, type Slot } from '@/lib/domain/booking/booking';
import { bookingIntake, listBookingIntakeForms, setTypeBookingIntake, workItemIntake } from '@/lib/domain/booking/intake';
import { createForm, createFormDraft, listFormSubmissions, publishFormRevision, saveFormDraft, setFormArchived } from '@/lib/domain/forms/forms';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { createResource } from '@/lib/domain/resources/resources';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A booking may ask the business's own questions, and the answers are recorded *with* the booking.
 *
 * What these prove, from the visitor's side and the owner's: the form is the type's and never the
 * browser's; the booking and its answers are one transaction, so a refusal on either leaves neither
 * (no work item, no submission, and the slot is free for the next visitor); the exact revision the
 * visitor saw is the one their answers are judged against; and a response can be traced to its
 * booking and a booking to its response.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DATE = '2027-03-15';
const ZONE = 'America/Toronto';

const INTAKE: FormDefinition = {
  title: 'About your vehicle',
  submitLabel: 'Send',
  confirmation: { title: 'Thanks', message: '' },
  fields: [
    { id: 'vehicle', type: 'short_text', label: 'Vehicle', required: true },
    { id: 'notes', type: 'long_text', label: 'Anything we should know?' },
  ],
};

type Business = {
  db: SupabaseClient;
  organizationId: string;
  typeId: string;
  type: BookableType;
  formId: string;
  revisionId: string;
  slug: string;
};

let pg: Client;
const client = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function business(label: string, options: { intake: boolean } = { intake: true }): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = client();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const organizationId = (await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Owner', timezone: ZONE, currency: 'CAD' })) as string;

  const typeId = await createWorkItemType(db, { schedulable: true, organizationId, name: 'Tyre change' });
  const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Requested' });
  await createResource(db, { resourceClass: 'other', organizationId, name: 'Van 1' });
  await addOperatingHours(db, { organizationId, dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' });
  await setModuleEnabled(db, { organizationId, key: 'booking', enabled: true });
  await setTypeBookable(db, { id: typeId, statusId, durationMinutes: 60, priceItemId: null });
  const organization = (await getOrganization(db, organizationId))!;
  await updateOrganization(db, {
    id: organizationId,
    name: organization.name,
    timezone: organization.timezone,
    currency: organization.currency!,
    bufferMinutes: organization.bufferMinutes,
    slug,
  });

  const { formId, revisionId } = await createForm(db, { organizationId, name: 'Vehicle details' });
  await saveFormDraft(db, { organizationId, revisionId, definition: INTAKE });
  await publishFormRevision(db, { organizationId, revisionId });
  if (options.intake) await setTypeBookingIntake(db, { typeId, formId });
  return { db, organizationId, typeId, type: { id: typeId, name: 'Tyre change', durationMinutes: 60, price: null }, formId, revisionId, slug };
}

async function visitor(b: Business): Promise<SupabaseClient> {
  const db = client();
  await beginBooking(db, { organizationId: b.organizationId });
  return db;
}

async function firstSlot(b: Business, db: SupabaseClient): Promise<Slot> {
  const slots = await bookableSlots(db, { organizationId: b.organizationId, type: b.type, date: DATE, timeZone: ZONE });
  return slots[0]!;
}

async function submissionsFor(b: Business) {
  const { rows } = await pg.query(
    'select id, source, customer_id, booking_work_item_id, form_revision_id, answers from public.form_submissions where organization_id = $1',
    [b.organizationId],
  );
  return rows as Array<{ id: string; source: string; customer_id: string | null; booking_work_item_id: string | null; form_revision_id: string; answers: Record<string, unknown> }>;
}

const WHO = { name: 'Camille', email: 'camille@example.test', phone: '' };

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});

describe('configuring what a booking asks', () => {
  it('accepts a published form of the same business, and offers only such forms', async () => {
    const b = await business('bi-config', { intake: false });
    expect(await listBookingIntakeForms(b.db, { organizationId: b.organizationId })).toEqual([{ id: b.formId, name: 'Vehicle details' }]);
    await setTypeBookingIntake(b.db, { typeId: b.typeId, formId: b.formId });
    expect((await bookingIntake(await visitor(b), { typeId: b.typeId }))?.formId).toBe(b.formId);
  });

  it('refuses another business’s form, an unpublished form and an archived one', async () => {
    const mine = await business('bi-mine', { intake: false });
    const theirs = await business('bi-theirs', { intake: false });
    await expect(setTypeBookingIntake(mine.db, { typeId: mine.typeId, formId: theirs.formId })).rejects.toMatchObject({ code: 'booking.intake_form_invalid' });

    const draft = await createForm(mine.db, { organizationId: mine.organizationId, name: 'Never published' });
    await expect(setTypeBookingIntake(mine.db, { typeId: mine.typeId, formId: draft.formId })).rejects.toMatchObject({ code: 'booking.intake_form_invalid' });

    await setFormArchived(mine.db, { organizationId: mine.organizationId, formId: mine.formId, archived: true });
    await expect(setTypeBookingIntake(mine.db, { typeId: mine.typeId, formId: mine.formId })).rejects.toMatchObject({ code: 'booking.intake_form_invalid' });
    expect(await listBookingIntakeForms(mine.db, { organizationId: mine.organizationId })).toEqual([]);
  });

  it('is only for a kind of work that is on the booking page, and withdrawing it withdraws the questions', async () => {
    const b = await business('bi-withdraw');
    await setTypeBookable(b.db, { id: b.typeId, statusId: null, durationMinutes: null });
    const { rows } = await pg.query('select booking_intake_form_id from public.work_item_types where id = $1', [b.typeId]);
    expect(rows[0].booking_intake_form_id).toBeNull();

    const other = await business('bi-unpublished', { intake: false });
    await setTypeBookable(other.db, { id: other.typeId, statusId: null, durationMinutes: null });
    await expect(setTypeBookingIntake(other.db, { typeId: other.typeId, formId: other.formId })).rejects.toMatchObject({ code: 'booking.intake_needs_booking' });
  });

  it('shows a visitor the questions of the business they are bound to, and nobody else’s', async () => {
    const a = await business('bi-a');
    const other = await business('bi-other');
    const seen = await bookingIntake(await visitor(a), { typeId: a.typeId });
    expect(seen).toMatchObject({ formId: a.formId, revisionId: a.revisionId });
    // A type id from another business answers nothing, not an error that says it exists.
    expect(await bookingIntake(await visitor(a), { typeId: other.typeId })).toBeNull();
    // A type that asks nothing answers nothing.
    const quiet = await business('bi-quiet', { intake: false });
    expect(await bookingIntake(await visitor(quiet), { typeId: quiet.typeId })).toBeNull();
  });
});

describe('a booking with its answers', () => {
  it('records the booking and a linked response in one act, against the exact revision', async () => {
    const b = await business('bi-ok');
    const db = await visitor(b);
    const shown = (await bookingIntake(db, { typeId: b.typeId }))!;
    const workItemId = await bookSlot(db, {
      organizationId: b.organizationId,
      typeId: b.typeId,
      slot: await firstSlot(b, db),
      ...WHO,
      intake: { revisionId: shown.revisionId, answers: { vehicle: 'Golf GTI', notes: 'Winter tyres' } },
    });

    const rows = await submissionsFor(b);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ source: 'booking', booking_work_item_id: workItemId, form_revision_id: b.revisionId, answers: { vehicle: 'Golf GTI', notes: 'Winter tyres' } });

    // The response is about the customer the booking found or made — the same one.
    const { rows: work } = await pg.query('select customer_id from public.work_items where id = $1', [workItemId]);
    expect(row!.customer_id).toBe(work[0].customer_id);

    // Both directions.
    const response = await workItemIntake(b.db, { organizationId: b.organizationId, workItemId });
    expect(response).toMatchObject({ submissionId: row!.id, formName: 'Vehicle details', revisionNumber: 1, answers: { vehicle: 'Golf GTI' } });
    const listed = await listFormSubmissions(b.db, b.organizationId, b.formId);
    expect(listed!.submissions[0]).toMatchObject({ source: 'booking', bookingWorkItemId: workItemId });
  });

  it('puts identifiers, never answers, in the event', async () => {
    const b = await business('bi-event');
    const db = await visitor(b);
    const shown = (await bookingIntake(db, { typeId: b.typeId }))!;
    const workItemId = await bookSlot(db, {
      organizationId: b.organizationId, typeId: b.typeId, slot: await firstSlot(b, db), ...WHO,
      intake: { revisionId: shown.revisionId, answers: { vehicle: 'Secret plate 123' } },
    });
    const { rows } = await pg.query("select payload from public.events where organization_id = $1 and action = 'form.submitted'", [b.organizationId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ form_id: b.formId, source: 'booking', work_item_id: workItemId });
    expect(JSON.stringify(rows[0].payload)).not.toContain('Secret plate');
  });

  it('refuses an invalid answer without booking: no work item, no response, and the time stays free', async () => {
    const b = await business('bi-invalid');
    const first = await visitor(b);
    const shown = (await bookingIntake(first, { typeId: b.typeId }))!;
    const slot = await firstSlot(b, first);
    // `vehicle` is required. The action checks first; this is the database's own refusal, reached
    // by a caller that skipped the check.
    await expect(
      bookSlot(first, { organizationId: b.organizationId, typeId: b.typeId, slot, ...WHO, intake: { revisionId: shown.revisionId, answers: { notes: 'x' } } }),
    ).rejects.toMatchObject({ code: 'booking.intake_invalid' });

    expect((await listWorkItems(b.db, { organizationId: b.organizationId, typeId: b.typeId })).length).toBe(0);
    expect(await submissionsFor(b)).toHaveLength(0);

    // The rollback took the resource assignment with it: the same time books for the next person.
    const second = await visitor(b);
    await bookSlot(second, { organizationId: b.organizationId, typeId: b.typeId, slot, ...WHO, intake: { revisionId: shown.revisionId, answers: { vehicle: 'Clio' } } });
    expect(await submissionsFor(b)).toHaveLength(1);
  });

  it('refuses answers given to a revision that is no longer the published one, and books nothing', async () => {
    const b = await business('bi-stale');
    const db = await visitor(b);
    const shown = (await bookingIntake(db, { typeId: b.typeId }))!;
    const slot = await firstSlot(b, db);

    // The business publishes a new revision while the visitor is answering.
    const draft = await createRevisionDraft(b);
    await publishFormRevision(b.db, { organizationId: b.organizationId, revisionId: draft });

    await expect(
      bookSlot(db, { organizationId: b.organizationId, typeId: b.typeId, slot, ...WHO, intake: { revisionId: shown.revisionId, answers: { vehicle: 'Golf' } } }),
    ).rejects.toMatchObject({ code: 'booking.intake_stale' });
    expect((await listWorkItems(b.db, { organizationId: b.organizationId, typeId: b.typeId })).length).toBe(0);
    expect(await submissionsFor(b)).toHaveLength(0);
  });

  it('refuses a booking that skips the questions it asks, and answers to a booking that asks none', async () => {
    const asks = await business('bi-skips');
    const db = await visitor(asks);
    await expect(
      bookSlot(db, { organizationId: asks.organizationId, typeId: asks.typeId, slot: await firstSlot(asks, db), ...WHO }),
    ).rejects.toMatchObject({ code: 'booking.intake_stale' });
    expect((await listWorkItems(asks.db, { organizationId: asks.organizationId, typeId: asks.typeId })).length).toBe(0);

    const quiet = await business('bi-asks-nothing', { intake: false });
    const other = await visitor(quiet);
    await expect(
      bookSlot(other, {
        organizationId: quiet.organizationId, typeId: quiet.typeId, slot: await firstSlot(quiet, other), ...WHO,
        intake: { revisionId: quiet.revisionId, answers: { vehicle: 'x' } },
      }),
    ).rejects.toMatchObject({ code: 'booking.intake_stale' });
    expect(await submissionsFor(quiet)).toHaveLength(0);
  });

  it('is never held hostage by a form somebody has since archived', async () => {
    const b = await business('bi-archived');
    await setFormArchived(b.db, { organizationId: b.organizationId, formId: b.formId, archived: true });
    const db = await visitor(b);
    expect(await bookingIntake(db, { typeId: b.typeId })).toBeNull();
    await bookSlot(db, { organizationId: b.organizationId, typeId: b.typeId, slot: await firstSlot(b, db), ...WHO });
    expect((await listWorkItems(b.db, { organizationId: b.organizationId, typeId: b.typeId })).length).toBe(1);
    expect(await submissionsFor(b)).toHaveLength(0);
  });

  it('is not refused by the form’s own flood guard', async () => {
    const b = await business('bi-flood');
    const { rows: owner } = await pg.query('select user_id from public.memberships where organization_id = $1 limit 1', [b.organizationId]);
    // Thirty responses in the last minute is exactly what a hosted form would refuse the next of.
    for (let i = 0; i < 30; i += 1) {
      await pg.query(
        "insert into public.form_submissions (organization_id, form_id, form_revision_id, submitted_by, answers, source) values ($1, $2, $3, $4, '{\"vehicle\":\"x\"}', 'hosted')",
        [b.organizationId, b.formId, b.revisionId, owner[0].user_id],
      );
    }
    const db = await visitor(b);
    await bookSlot(db, {
      organizationId: b.organizationId, typeId: b.typeId, slot: await firstSlot(b, db), ...WHO,
      intake: { revisionId: b.revisionId, answers: { vehicle: 'Polo' } },
    });
    expect((await submissionsFor(b)).filter((row) => row.source === 'booking')).toHaveLength(1);
  });

  it('keeps the link honest: only a booking response names a booking, and a booking has one response', async () => {
    const b = await business('bi-link');
    const db = await visitor(b);
    const shown = (await bookingIntake(db, { typeId: b.typeId }))!;
    const workItemId = await bookSlot(db, {
      organizationId: b.organizationId, typeId: b.typeId, slot: await firstSlot(b, db), ...WHO,
      intake: { revisionId: shown.revisionId, answers: { vehicle: 'Golf' } },
    });
    const { rows: owner } = await pg.query('select user_id from public.memberships where organization_id = $1 limit 1', [b.organizationId]);
    const insert = (source: string) =>
      pg.query(
        "insert into public.form_submissions (organization_id, form_id, form_revision_id, submitted_by, answers, source, booking_work_item_id) values ($1, $2, $3, $4, '{\"vehicle\":\"x\"}', $5, $6)",
        [b.organizationId, b.formId, b.revisionId, owner[0].user_id, source, workItemId],
      );
    await expect(insert('hosted')).rejects.toThrow(/form_submissions_booking_link_is_booking/);
    await expect(insert('booking')).rejects.toThrow(/form_submissions_one_per_booking/);
  });

  it('cannot be read by a stranger, or by a member of another business', async () => {
    const b = await business('bi-private');
    const other = await business('bi-nosy');
    const db = await visitor(b);
    const shown = (await bookingIntake(db, { typeId: b.typeId }))!;
    const workItemId = await bookSlot(db, {
      organizationId: b.organizationId, typeId: b.typeId, slot: await firstSlot(b, db), ...WHO,
      intake: { revisionId: shown.revisionId, answers: { vehicle: 'Golf' } },
    });
    expect(await workItemIntake(db, { organizationId: b.organizationId, workItemId })).toBeNull();
    expect(await workItemIntake(other.db, { organizationId: b.organizationId, workItemId })).toBeNull();
    expect(await workItemIntake(other.db, { organizationId: other.organizationId, workItemId })).toBeNull();
  });
});

/** A new draft of the business's form, retitled — which is all publishing a second revision needs. */
async function createRevisionDraft(b: Business): Promise<string> {
  const revisionId = await createFormDraft(b.db, b.organizationId, b.formId);
  await saveFormDraft(b.db, { organizationId: b.organizationId, revisionId, definition: { ...INTAKE, title: 'About your vehicle, v2' } });
  return revisionId;
}
