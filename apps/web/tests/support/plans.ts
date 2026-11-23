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
 * Since ADR-057 a plan is created in GildOps' Finance and sold as a subscription there; the
 * subscription's plan lines become the business's plan assignments, and an agreed price is a price
 * on the subscription line. A suite that only needs the resulting state writes it here, as the
 * database owner, through the internal writers the Finance doors call (`app.write_plan_assignment`,
 * `app.write_subscription*`) or straight into the tables those doors fill. Suites that test the
 * doors themselves call them as a real member.
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

/**
 * The operating organization's subscription line behind the plan a business holds, creating one when
 * the assignment carries out none (a fixture wrote the assignment directly): a GildOps customer
 * named after the business, a subscription in the business's currency, and a line for the plan's
 * item, linked to the assignment. Returns the line id.
 */
export async function seedPlanSubscriptionLine(
  pg: Client,
  input: { organizationId: string; planId: string; currency: string; actorId: string },
): Promise<string> {
  const { rows } = await pg.query<{ line_id: string | null; assignment_id: string; period_start: string; period_end: string; plan_kind: string; item_id: string | null; seller_id: string | null; name: string }>(
    `select a.subscription_line_id as line_id, a.id as assignment_id, a.period_start::text, a.period_end::text, a.plan_kind,
            p.price_book_item_id as item_id, app.platform_seller_id() as seller_id, o.name
       from public.organization_plan_assignments a
       join public.platform_plans p on p.id = a.plan_id
       join public.organizations o on o.id = a.organization_id
      where a.organization_id = $1 and a.plan_id = $2
      order by (a.period_start <= current_date and a.period_end > current_date) desc, a.period_start desc
      limit 1`,
    [input.organizationId, input.planId],
  );
  const held = rows[0];
  if (!held) throw new Error(`Fixture: ${input.organizationId} holds no plan ${input.planId} to agree a price for.`);
  if (held.line_id) return held.line_id;
  if (!held.seller_id || !held.item_id) throw new Error('Fixture: an agreed price needs a designated operating organization and a plan item.');
  const { rows: made } = await pg.query<{ line_id: string }>(
    `with customer as (
       insert into public.contacts (organization_id, name, contact_type, lifecycle, custom, created_by)
       values ($1, $2, 'company', 'customer', '{}'::jsonb, $3) returning id
     ), subscription as (
       select app.write_subscription($1, (select id from customer), $4, 'month', $5::date, null, $3, 'fixture') as id
     )
     select app.write_subscription_line($1, (select id from subscription), $6, $7, 1, $5::date,
                                        nullif($8::date, date '9999-12-31'), $3, 'fixture') as line_id`,
    [held.seller_id, left200(held.name), input.actorId, input.currency.toUpperCase(), held.period_start, held.item_id, held.plan_kind === 'plan' ? 'primary' : 'addon', held.period_end],
  );
  await pg.query('update public.organization_plan_assignments set subscription_line_id = $1 where id = $2', [made[0].line_id, held.assignment_id]);
  return made[0].line_id;
}

function left200(value: string): string {
  return value.slice(0, 200);
}

/** An agreed price for a plan a business holds: an agreed price on its subscription line, written the way `set_subscription_price` writes it. */
export async function seedPlanAgreement(
  pg: Client,
  input: { organizationId: string; planId: string; currency: string; amountMinor: number; effectiveFrom?: string; effectiveTo?: string | null; actorId: string; note?: string },
): Promise<string> {
  const lineId = await seedPlanSubscriptionLine(pg, input);
  const { rows } = await pg.query<{ id: string; organization_id: string }>(
    `select app.write_subscription_agreed_price(l.organization_id, l.id, $2, $3::timestamptz, $4, $5) as id, l.organization_id
       from public.subscription_lines l where l.id = $1`,
    [lineId, input.amountMinor, input.effectiveFrom ?? new Date().toISOString(), input.actorId, input.note ?? ''],
  );
  if (input.effectiveTo) {
    await pg.query('update public.subscription_agreed_prices set effective_to = $2 where id = $1', [rows[0].id, input.effectiveTo]);
  }
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
       select organization_id, id, $2, $3, $4, $5 from app.plan_agreed_prices where id = $1 returning id`,
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

/**
 * A plan's own usage price for a meter, on the plan's item, as `record_item_usage_price` writes one.
 * Usage is priced only by the plans a business holds: there is no platform-wide price (ADR-057).
 */
export function recordFixtureUsagePrice(input: { planId: string; meterId: string; currency: string; unitAmountMicros: number; source?: string; effectiveFrom?: string; effectiveTo?: string | null; note?: string }): Promise<string> {
  return withDatabaseOwner(async (pg) => {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.price_book_item_usage_prices (organization_id, item_id, meter_id, currency, unit_amount_micros, source, effective_from, effective_to, note)
       select i.organization_id, i.id, $2, upper($3), $4, $5, coalesce($6::timestamptz, now()), $7::timestamptz, $8
         from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id
        where p.id = $1
       returning id`,
      [input.planId, input.meterId, input.currency, input.unitAmountMicros, input.source ?? 'test', input.effectiveFrom ?? null, input.effectiveTo ?? null, input.note ?? ''],
    );
    if (!rows[0]) throw new Error(`Fixture: plan ${input.planId} has no catalog item to price usage on; designate an operating organization first.`);
    return rows[0].id;
  });
}

/**
 * GildOps sells a plan (and any add-ons after it) to a business the way Finance does: a GildOps
 * customer for the business, linked to it, subscribing to the plan's item through
 * `create_subscription` as `seller` — a GildOps member who manages subscriptions. The link
 * provisions the plan onto the business. A fixture plan usually has no list price, so each line is
 * agreed at nothing unless `agreedAmountMinor` says otherwise; pass `null` to pay the list price.
 */
export async function sellFixturePlan(
  seller: SupabaseClient,
  input: { organizationId: string; planId: string; addonPlanIds?: string[]; periodStart?: string; periodEnd?: string; agreedAmountMinor?: number | null; note?: string },
): Promise<{ subscriptionId: string; customerId: string; sellerId: string }> {
  const context = await withDatabaseOwner(async (pg) => {
    const { rows } = await pg.query<{ seller_id: string | null; currency: string | null; name: string; actor: string | null }>(
      `select app.platform_seller_id() as seller_id, o.currency, o.name,
              (select m.user_id from public.memberships m where m.organization_id = app.platform_seller_id() order by m.created_at limit 1) as actor
         from public.organizations o where o.id = $1`,
      [input.organizationId],
    );
    const found = rows[0];
    if (!found?.seller_id || !found.actor) throw new Error('Fixture: selling a plan needs a designated operating organization with a member.');
    const linked = await pg.query<{ customer_id: string }>(
      `select customer_id from public.client_tenant_relationships where organization_id = $1 and tenant_organization_id = $2 and status = 'active' limit 1`,
      [found.seller_id, input.organizationId],
    );
    let customerId = linked.rows[0]?.customer_id;
    if (!customerId) {
      const created = await pg.query<{ id: string }>(
        `insert into public.contacts (organization_id, name, contact_type, lifecycle, custom, created_by)
         values ($1, $2, 'company', 'customer', '{}'::jsonb, $3) returning id`,
        [found.seller_id, found.name.slice(0, 200), found.actor],
      );
      customerId = created.rows[0].id;
      await pg.query(
        `insert into public.client_tenant_relationships (organization_id, customer_id, tenant_organization_id, origin, authority_basis, created_by)
         values ($1, $2, $3, 'existing_tenant_link', 'Test fixture: GildOps provisioned this business', $4)`,
        [found.seller_id, customerId, input.organizationId, found.actor],
      );
    }
    const items = await pg.query<{ id: string; item: string | null }>('select id, price_book_item_id as item from public.platform_plans where id = any($1)', [[input.planId, ...(input.addonPlanIds ?? [])]]);
    return { sellerId: found.seller_id, currency: found.currency ?? 'CAD', customerId, item: (planId: string) => items.rows.find((row) => row.id === planId)?.item ?? null };
  });
  const planItem = context.item(input.planId);
  if (!planItem) throw new Error(`Fixture: plan ${input.planId} has no catalog item to sell.`);
  const agreed = input.agreedAmountMinor === undefined ? 0 : input.agreedAmountMinor;
  const startsOn = (input.periodStart ?? new Date().toISOString()).slice(0, 10);
  const endsOn = input.periodEnd && input.periodEnd.slice(0, 10) !== '9999-12-31' ? input.periodEnd.slice(0, 10) : null;
  const created = await seller.rpc('create_subscription', {
    p_organization_id: context.sellerId, p_customer_id: context.customerId, p_item_id: planItem, p_currency: context.currency,
    p_billing_interval: 'month', p_starts_on: startsOn, p_ends_on: endsOn, p_agreed_amount_minor: agreed, p_note: input.note ?? '',
  });
  if (created.error) throw Object.assign(new Error(created.error.message), { code: created.error.code });
  for (const addonPlanId of input.addonPlanIds ?? []) {
    const addonItem = context.item(addonPlanId);
    const attached = await seller.rpc('set_item_addon', { p_organization_id: context.sellerId, p_item_id: planItem, p_addon_item_id: addonItem, p_attached: true, p_included_by_default: false });
    if (attached.error) throw attached.error;
    const added = await seller.rpc('add_subscription_addon', { p_subscription_id: created.data, p_item_id: addonItem, p_starts_on: startsOn, p_agreed_amount_minor: agreed });
    if (added.error) throw Object.assign(new Error(added.error.message), { code: added.error.code });
  }
  return { subscriptionId: created.data as string, customerId: context.customerId, sellerId: context.sellerId };
}
