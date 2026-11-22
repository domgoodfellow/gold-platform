import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { foundBusiness } from './founding';
import { setAsideOperatingOrganization } from './operating-organization';

const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Runs `use` on a short-lived database-owner connection, for callers that hold none. */
export async function withDatabaseOwner<T>(work: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  try {
    return await work(pg);
  } finally {
    await pg.end();
  }
}

/** The business's first member — or, for a business with none, the oldest account — standing in as the account a fixture record names. */
async function firstMember(pg: Client, organizationId: string): Promise<string> {
  const { rows } = await pg.query<{ user_id: string }>(
    `select coalesce(
       (select user_id from public.memberships where organization_id = $1 order by created_at, user_id limit 1),
       (select id from auth.users order by created_at, id limit 1)) as user_id`,
    [organizationId],
  );
  if (!rows[0]?.user_id) throw new Error(`Fixture: no account exists to record ${organizationId}'s fixture against.`);
  return rows[0].user_id;
}

/** A plan, created over its own connection. */
export function createFixturePlan(input: SeedPlanInput): Promise<string> {
  return withDatabaseOwner((pg) => seedPlan(pg, input));
}

/** A business holds a plan for a period; recorded against its first member unless `actorId` is given. */
export function assignFixturePlan(input: { organizationId: string; planId: string; periodStart: string; periodEnd: string; actorId?: string; note?: string }): Promise<string> {
  return withDatabaseOwner(async (pg) => seedPlanAssignment(pg, { ...input, actorId: input.actorId ?? (await firstMember(pg, input.organizationId)) }));
}

/** A per-product term; recorded against the business's first member unless `recordedBy` is given. */
export function recordFixtureTerm(input: { organizationId: string; productKey: string; periodStart: string; periodEnd: string; priceMinor: number; currency?: string | null; recordedBy?: string; note?: string }): Promise<string> {
  return withDatabaseOwner(async (pg) => seedCommercialTerm(pg, { ...input, recordedBy: input.recordedBy ?? (await firstMember(pg, input.organizationId)) }));
}

/** A plan's list price, over its own connection. */
export function priceFixturePlan(input: Parameters<typeof seedPlanPrice>[1]): Promise<string> {
  return withDatabaseOwner((pg) => seedPlanPrice(pg, input));
}

/**
 * Plan fixtures for suites that need a business to hold a plan, not to test who may give it one.
 *
 * Since ADR-057 a plan is created in GildOps' Finance, and assignments, agreed prices and terms
 * are recorded with Finance permissions in GildOps' operating organization. A suite that only needs
 * the resulting state writes it here, as the database owner, through the same internal writers the
 * Finance doors call (`app.write_plan_assignment`, `app.write_plan_agreement`) or straight into the
 * tables those doors fill. Suites that test the doors themselves call them as a real member.
 */

export type SeedPlanInput = {
  key: string;
  kind?: 'plan' | 'addon';
  label: string;
  description?: string;
  billable?: boolean;
  saleStatus?: 'active' | 'unlisted' | 'archived';
  displayOrder?: number;
  /** Who created it; the oldest account when not given, as every catalog item names a creator. */
  createdBy?: string;
};

/** A plan record; when an operating organization is designated its recurring item is created with it. */
export async function seedPlan(pg: Client, input: SeedPlanInput): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::uuid, (select id from auth.users order by created_at, id limit 1))) returning id`,
    [input.key, input.kind ?? 'plan', input.label, input.description ?? '', input.billable ?? true, input.saleStatus ?? 'active', input.displayOrder ?? 0, input.createdBy ?? null],
  );
  return rows[0].id;
}

/** What a business holds for a period, written the way `record_plan_assignment` writes it. */
export async function seedPlanAssignment(
  pg: Client,
  input: { organizationId: string; planId: string; periodStart: string; periodEnd: string; actorId: string; note?: string },
): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    'select app.write_plan_assignment($1, $2, $3::date, $4::date, $5, $6) as id',
    [input.organizationId, input.planId, input.periodStart.slice(0, 10), input.periodEnd.slice(0, 10), input.actorId, input.note ?? ''],
  );
  return rows[0].id;
}

/** An agreed price for a plan a business holds, written the way `record_organization_plan_agreement` writes it. */
export async function seedPlanAgreement(
  pg: Client,
  input: { organizationId: string; planId: string; currency: string; amountMinor: number; effectiveFrom?: string; effectiveTo?: string | null; actorId: string; note?: string },
): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    'select app.write_plan_agreement($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8) as id',
    [input.organizationId, input.planId, input.currency, input.amountMinor, input.effectiveFrom ?? new Date().toISOString(), input.effectiveTo ?? null, input.actorId, input.note ?? ''],
  );
  return rows[0].id;
}

/** A plan's list price; the price book's fill trigger files it under the plan's recurring item. */
export async function seedPlanPrice(
  pg: Client,
  input: { planId: string; currency: string; amountMinor: number; billingInterval: 'month' | 'year' | 'one_time'; effectiveFrom?: string; source?: string; note?: string },
): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.price_book_item_prices (plan_id, currency, amount_minor, billing_interval, effective_from, approval_state, source, note)
     values ($1, $2, $3, $4, $5, 'approved', $6, $7) returning id`,
    [input.planId, input.currency, input.amountMinor, input.billingInterval, input.effectiveFrom ?? new Date().toISOString(), input.source ?? 'test', input.note ?? ''],
  );
  return rows[0].id;
}

/** A per-product term, written the way `record_commercial_term` writes it. `recordedBy` is any real account. */
export async function seedCommercialTerm(
  pg: Client,
  input: { organizationId: string; productKey: string; periodStart: string; periodEnd: string; priceMinor: number; currency?: string | null; recordedBy: string; note?: string },
): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.organization_commercial_terms (organization_id, product_key, period_start, period_end, price_minor, currency, recorded_by, note)
     values ($1, $2, $3::date, $4::date, $5, $6, $7, $8) returning id`,
    [input.organizationId, input.productKey, input.periodStart.slice(0, 10), input.periodEnd.slice(0, 10), input.priceMinor, input.currency ? input.currency.toUpperCase() : null, input.recordedBy, input.note ?? ''],
  );
  return rows[0].id;
}

/**
 * Makes `userId` a member of GildOps' operating organization with the Finance permissions that sell
 * GildOps, so a suite can call the Finance doors as a real seller. Returns the role id.
 */
export async function grantGildOpsFinance(
  pg: Client,
  input: { operatingOrganizationId: string; userId: string; capabilities?: string[]; createdBy?: string },
): Promise<string> {
  const capabilities = input.capabilities ?? ['subscription.read', 'subscription.manage', 'cost.read', 'cost.manage', 'price.manage'];
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.roles (organization_id, name, capabilities, created_by) values ($1, $2, $3, $4) returning id`,
    [input.operatingOrganizationId, `Finance ${Math.random().toString(36).slice(2, 8)}`, capabilities, input.createdBy ?? input.userId],
  );
  await pg.query(
    `insert into public.memberships (organization_id, user_id, role_id, created_by) values ($1, $2, $3, $4)
       on conflict (organization_id, user_id) do update set role_id = excluded.role_id`,
    [input.operatingOrganizationId, input.userId, rows[0].id, input.createdBy ?? input.userId],
  );
  return rows[0].id;
}

/** The billing provider's reference for a plan's list price, as checkout provisioning records it. */
export function mapFixturePlanPrice(input: { planPriceId: string; environment: 'sandbox' | 'live'; productReference: string; priceReference: string; provisionedBy?: string }): Promise<string> {
  return withDatabaseOwner(async (pg) => {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.price_book_item_provider_prices (plan_price_id, environment, provider, product_reference, price_reference, provisioned_by)
       values ($1, $2, 'stripe', $3, $4, coalesce($5::uuid, (select id from auth.users order by created_at, id limit 1))) returning id`,
      [input.planPriceId, input.environment, input.productReference, input.priceReference, input.provisionedBy ?? null],
    );
    return rows[0].id;
  });
}

/** An agreed price over its own connection; recorded against the business's first member unless `actorId` is given. */
export function agreeFixturePrice(input: { organizationId: string; planId: string; currency: string; amountMinor: number; effectiveFrom?: string; effectiveTo?: string | null; actorId?: string; note?: string }): Promise<string> {
  return withDatabaseOwner(async (pg) => seedPlanAgreement(pg, { ...input, actorId: input.actorId ?? (await firstMember(pg, input.organizationId)) }));
}

/** The billing provider's reference for one agreed price, as `record_agreement_provider_price` records it. */
export function mapFixtureAgreementPrice(input: { agreementId: string; environment: 'sandbox' | 'live'; billingInterval: 'month' | 'year'; productReference: string; priceReference: string }): Promise<string> {
  return withDatabaseOwner(async (pg) => {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.organization_plan_agreement_provider_prices (organization_id, agreement_id, environment, billing_interval, product_reference, price_reference)
       select organization_id, id, $2, $3, $4, $5 from public.organization_plan_agreements where id = $1 returning id`,
      [input.agreementId, input.environment, input.billingInterval, input.productReference, input.priceReference],
    );
    if (!rows[0]) throw new Error(`Fixture: no agreement ${input.agreementId}.`);
    return rows[0].id;
  });
}

/**
 * For a suite that exercises GildOps' Finance doors themselves: sets aside whatever operating
 * organization is designated, founds a fresh one owned by a new account, designates it, and returns
 * the owner's signed-in client. A founding role holds every permission, so the owner is a seller
 * with every Finance permission. `restore` puts the previous designation back.
 */
export async function designateGildOps(pg: Client, label = 'gildops'): Promise<{ db: SupabaseClient; organizationId: string; userId: string; restore: () => Promise<void> }> {
  const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const restore = await setAsideOperatingOrganization(pg);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `GildOps ${randomUUID().slice(0, 6)}`, currency: 'CAD' });
  await pg.query('update public.platform_settings set operating_organization_id = $1 where singleton', [organizationId]);
  return { db, organizationId, userId: created.data.user.id, restore };
}

/** A usage price for a meter in every plan, as the retired global retail-rate list held one; the rate resolver still reads such rows. */
export function recordFixtureRetailRate(input: { meterId: string; currency: string; unitAmountMicros: number; source?: string; effectiveFrom?: string; note?: string }): Promise<string> {
  return withDatabaseOwner(async (pg) => {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.platform_retail_rates (meter_id, currency, unit_amount_micros, source, effective_from, note)
       values ($1, upper($2), $3, $4, coalesce($5::timestamptz, now()), $6) returning id`,
      [input.meterId, input.currency, input.unitAmountMicros, input.source ?? 'test', input.effectiveFrom ?? null, input.note ?? ''],
    );
    return rows[0].id;
  });
}
