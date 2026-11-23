import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Subscriptions: a recurring agreement between a business and one of its own customers (ADR-057).
 * Any business with Finance keeps them; GildOps sells its plans with exactly these records. A
 * subscription is for one primary recurring item and any add-ons, each a line with its own dates,
 * in one currency and billing interval. A line pays its item's list price unless a price was
 * agreed for it. Who may read and change them is the database's answer: `subscription.read` and
 * `subscription.manage` in the selling business. Nothing here knows which business is GildOps.
 */

export type SubscriptionInterval = 'month' | 'year';
export type SubscriptionCollection = 'manual' | 'provider';
export type SubscriptionStatus = 'scheduled' | 'active' | 'ending' | 'ended';
export type SubscriptionLineRole = 'primary' | 'addon';

export type Subscription = {
  id: string;
  organizationId: string;
  customerId: string;
  currency: string;
  billingInterval: SubscriptionInterval;
  /** Who invoices it: Finance, period by period (`manual`), or a billing provider (`provider`). */
  collection: SubscriptionCollection;
  startsOn: string;
  /** The first day it no longer runs; null while it runs on. */
  endsOn: string | null;
  canceledAt: string | null;
  cancelReason: string;
  note: string;
  createdAt: string;
};

export type SubscriptionLine = {
  id: string;
  subscriptionId: string;
  itemId: string;
  role: SubscriptionLineRole;
  quantity: number;
  startsOn: string;
  endsOn: string | null;
  recordedAt: string;
  note: string;
};

export type AgreedPrice = {
  id: string;
  lineId: string;
  currency: string;
  amountMinor: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  recordedAt: string;
  note: string;
};

/** A line's price at a moment, by the database's one rule. `sourceId` is the agreed price or list price row. */
export type LinePrice = {
  lineId: string;
  amountMinor: number;
  currency: string;
  billingInterval: SubscriptionInterval | 'one_time';
  source: 'agreed' | 'list';
  sourceId: string;
};

const SUBSCRIPTION_COLUMNS = 'id, organization_id, customer_id, currency, billing_interval, collection, starts_on, ends_on, canceled_at, cancel_reason, note, created_at';
const LINE_COLUMNS = 'id, subscription_id, item_id, role, quantity, starts_on, ends_on, recorded_at, note';

type SubscriptionRow = {
  id: string; organization_id: string; customer_id: string; currency: string; billing_interval: string; collection: string;
  starts_on: string; ends_on: string | null; canceled_at: string | null; cancel_reason: string; note: string; created_at: string;
};
type LineRow = { id: string; subscription_id: string; item_id: string; role: string; quantity: number; starts_on: string; ends_on: string | null; recorded_at: string; note: string };

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    currency: row.currency,
    billingInterval: row.billing_interval as SubscriptionInterval,
    collection: row.collection as SubscriptionCollection,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason,
    note: row.note,
    createdAt: row.created_at,
  };
}

function toLine(row: LineRow): SubscriptionLine {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    itemId: row.item_id,
    role: row.role as SubscriptionLineRole,
    quantity: Number(row.quantity),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    recordedAt: row.recorded_at,
    note: row.note,
  };
}

/** Today as a calendar date in UTC, the date the database compares subscription dates against. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Where a subscription stands on a day. Derived from its dates; stored nowhere. */
export function subscriptionStatus(subscription: Pick<Subscription, 'startsOn' | 'endsOn'>, today: string = todayIso()): SubscriptionStatus {
  if (subscription.startsOn > today) return 'scheduled';
  if (subscription.endsOn !== null && subscription.endsOn <= today) return 'ended';
  return subscription.endsOn !== null ? 'ending' : 'active';
}

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  scheduled: 'Starts later',
  active: 'Active',
  ending: 'Ending',
  ended: 'Ended',
};

/** Whether a line is in force on a day: started, and not yet ended. */
export function lineInForce(line: Pick<SubscriptionLine, 'startsOn' | 'endsOn'>, day: string = todayIso()): boolean {
  return line.startsOn <= day && (line.endsOn === null || line.endsOn > day);
}

export async function listSubscriptions(db: Db, input: { organizationId: string; customerId?: string }): Promise<Subscription[]> {
  let query = db.from('subscriptions').select(SUBSCRIPTION_COLUMNS).eq('organization_id', input.organizationId).order('starts_on', { ascending: false });
  if (input.customerId) query = query.eq('customer_id', input.customerId);
  const { data, error } = await query;
  if (error) throw fromDatabaseError(error, 'subscriptions.list_failed');
  return (data ?? []).map((row) => toSubscription(row as SubscriptionRow));
}

export async function getSubscription(db: Db, input: { organizationId: string; subscriptionId: string }): Promise<Subscription | null> {
  const { data, error } = await db.from('subscriptions').select(SUBSCRIPTION_COLUMNS)
    .eq('organization_id', input.organizationId).eq('id', input.subscriptionId).maybeSingle();
  if (error) throw fromDatabaseError(error, 'subscriptions.read_failed');
  return data ? toSubscription(data as SubscriptionRow) : null;
}

export async function listSubscriptionLines(db: Db, input: { organizationId: string; subscriptionIds: string[] }): Promise<SubscriptionLine[]> {
  if (input.subscriptionIds.length === 0) return [];
  const { data, error } = await db.from('subscription_lines').select(LINE_COLUMNS)
    .eq('organization_id', input.organizationId).in('subscription_id', input.subscriptionIds)
    .order('starts_on').order('role', { ascending: false });
  if (error) throw fromDatabaseError(error, 'subscriptions.lines_failed');
  return (data ?? []).map((row) => toLine(row as LineRow));
}

export async function listAgreedPrices(db: Db, input: { organizationId: string; lineIds: string[] }): Promise<AgreedPrice[]> {
  if (input.lineIds.length === 0) return [];
  const { data, error } = await db.from('subscription_agreed_prices')
    .select('id, line_id, currency, amount_minor, effective_from, effective_to, recorded_at, note')
    .eq('organization_id', input.organizationId).in('line_id', input.lineIds)
    .order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'subscriptions.agreed_prices_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    lineId: row.line_id,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    recordedAt: row.recorded_at,
    note: row.note,
  }));
}

/** Every line's price at a moment, as the database prices it (the same rule its invoices use). */
export async function subscriptionLinePrices(db: Db, input: { subscriptionId: string; at?: string }): Promise<LinePrice[]> {
  const { data, error } = await db.rpc('subscription_line_prices', { p_subscription_id: input.subscriptionId, p_at: input.at ?? new Date().toISOString() });
  if (error) throw fromDatabaseError(error, 'subscriptions.prices_failed');
  return (data ?? []).map((row) => ({
    lineId: row.line_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    billingInterval: row.billing_interval as LinePrice['billingInterval'],
    source: row.source as LinePrice['source'],
    sourceId: row.source_id,
  }));
}

/**
 * The recurring amount of the lines in force, per billing interval. Null when a line in force is
 * not priced or two lines are priced in different currencies: an unknown total, never a guess.
 */
export function recurringAmount(lines: readonly SubscriptionLine[], prices: readonly LinePrice[], day: string = todayIso()): { amountMinor: number; currency: string } | null {
  const inForce = lines.filter((line) => lineInForce(line, day));
  if (inForce.length === 0) return null;
  const priced = inForce.map((line) => ({ line, price: prices.find((price) => price.lineId === line.id) ?? null }));
  if (priced.some((entry) => entry.price === null)) return null;
  const recurring = priced.filter((entry) => entry.price?.billingInterval !== 'one_time');
  const currencies = new Set(recurring.map((entry) => entry.price?.currency));
  if (currencies.size > 1) return null;
  const currency = recurring[0]?.price?.currency ?? priced[0].price?.currency ?? '';
  return { amountMinor: recurring.reduce((sum, entry) => sum + (entry.price?.amountMinor ?? 0) * entry.line.quantity, 0), currency };
}

const REFUSALS: Record<string, string> = {
  '42501': 'Your role cannot change subscriptions in this business.',
  '23503': 'That recurring item or subscription is not in this business.',
  '23P01': 'That overlaps something this subscription, or this business, already has for those dates.',
  GD011: 'That customer is not in this business.',
  GD040: 'A line starts within its subscription.',
  GD041: 'A price change starts after the last one.',
  GD042: 'That item has no list price in this subscription’s currency and interval. Agree a price for it.',
  GD043: 'That item is not an add-on of what this subscription is for.',
  GD044: 'There is nothing in force before that date to change, or it is already that item.',
  GD045: 'Only an add-on ends on its own. End the subscription instead.',
};

function refuse(error: { code?: string; message: string }, code: string): never {
  const known = error.code ? REFUSALS[error.code] : undefined;
  if (known) throw new DomainError(known, code);
  if (error.code === '22023') throw new DomainError(error.message, code);
  throw fromDatabaseError(error, code);
}

function wholeQuantity(quantity: number | undefined): number {
  const value = quantity ?? 1;
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new DomainError('Quantity is a whole number from 1 to 1,000,000.', 'subscriptions.quantity_invalid');
  }
  return value;
}

function minorAmount(amountMinor: number | null | undefined): number | null {
  if (amountMinor === null || amountMinor === undefined) return null;
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new DomainError('An agreed price is zero or more.', 'subscriptions.amount_invalid');
  }
  return amountMinor;
}

export async function createSubscription(
  db: Db,
  input: {
    organizationId: string; customerId: string; itemId: string; currency: string; billingInterval: SubscriptionInterval;
    startsOn: string; endsOn?: string | null; quantity?: number; agreedAmountMinor?: number | null; note?: string;
  },
): Promise<string> {
  await requireActor(db);
  const { data, error } = await db.rpc('create_subscription', {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_item_id: input.itemId,
    p_currency: input.currency,
    p_billing_interval: input.billingInterval,
    p_starts_on: input.startsOn,
    p_ends_on: (input.endsOn || null) as string,
    p_quantity: wholeQuantity(input.quantity),
    p_agreed_amount_minor: minorAmount(input.agreedAmountMinor) as number,
    p_note: input.note ?? '',
  });
  if (error) refuse(error, 'subscriptions.create_failed');
  return data as string;
}

export async function addSubscriptionAddon(
  db: Db,
  input: { subscriptionId: string; itemId: string; startsOn: string; quantity?: number; agreedAmountMinor?: number | null; note?: string },
): Promise<string> {
  await requireActor(db);
  const { data, error } = await db.rpc('add_subscription_addon', {
    p_subscription_id: input.subscriptionId,
    p_item_id: input.itemId,
    p_starts_on: input.startsOn,
    p_quantity: wholeQuantity(input.quantity),
    p_agreed_amount_minor: minorAmount(input.agreedAmountMinor) as number,
    p_note: input.note ?? '',
  });
  if (error) refuse(error, 'subscriptions.addon_failed');
  return data as string;
}

export async function changeSubscriptionItem(
  db: Db,
  input: { subscriptionId: string; itemId: string; effectiveOn: string; agreedAmountMinor?: number | null; note?: string },
): Promise<string> {
  await requireActor(db);
  const { data, error } = await db.rpc('change_subscription_item', {
    p_subscription_id: input.subscriptionId,
    p_item_id: input.itemId,
    p_effective_on: input.effectiveOn,
    p_agreed_amount_minor: minorAmount(input.agreedAmountMinor) as number,
    p_note: input.note ?? '',
  });
  if (error) refuse(error, 'subscriptions.change_failed');
  return data as string;
}

/** Agrees a price for one line from a moment on; `amountMinor: null` returns the line to its list price. */
export async function setSubscriptionPrice(
  db: Db,
  input: { lineId: string; amountMinor: number | null; effectiveFrom?: string; note?: string },
): Promise<string | null> {
  await requireActor(db);
  const { data, error } = await db.rpc('set_subscription_price', {
    p_line_id: input.lineId,
    p_amount_minor: minorAmount(input.amountMinor) as number,
    p_effective_from: input.effectiveFrom ?? new Date().toISOString(),
    p_note: input.note ?? '',
  });
  if (error) refuse(error, 'subscriptions.price_failed');
  return (data as string | null) ?? null;
}

export async function endSubscriptionAddon(db: Db, input: { lineId: string; endsOn: string }): Promise<void> {
  await requireActor(db);
  const { error } = await db.rpc('end_subscription_addon', { p_line_id: input.lineId, p_ends_on: input.endsOn });
  if (error) refuse(error, 'subscriptions.end_addon_failed');
}

export async function cancelSubscription(db: Db, input: { subscriptionId: string; endsOn: string; reason?: string }): Promise<void> {
  await requireActor(db);
  const { error } = await db.rpc('cancel_subscription', { p_subscription_id: input.subscriptionId, p_ends_on: input.endsOn, p_reason: input.reason ?? '' });
  if (error) refuse(error, 'subscriptions.cancel_failed');
}

/** An agreed usage price for one line and meter from a moment on; `unitAmountMicros: null` returns it to the item's usage price. */
export async function setSubscriptionUsagePrice(
  db: Db,
  input: { lineId: string; meterId: string; unitAmountMicros: number | null; effectiveFrom?: string },
): Promise<string | null> {
  await requireActor(db);
  if (input.unitAmountMicros !== null && (!Number.isInteger(input.unitAmountMicros) || input.unitAmountMicros < 0)) {
    throw new DomainError('A usage price is zero or more.', 'subscriptions.usage_price_invalid');
  }
  const { data, error } = await db.rpc('set_subscription_usage_price', {
    p_line_id: input.lineId,
    p_meter_id: input.meterId,
    p_unit_amount_micros: input.unitAmountMicros as number,
    p_effective_from: input.effectiveFrom ?? new Date().toISOString(),
  });
  if (error) refuse(error, 'subscriptions.usage_price_failed');
  return (data as string | null) ?? null;
}

export type AgreedUsagePrice = { id: string; lineId: string; meterId: string; currency: string; unitAmountMicros: number; effectiveFrom: string; effectiveTo: string | null };

export async function listAgreedUsagePrices(db: Db, input: { organizationId: string; lineIds: string[] }): Promise<AgreedUsagePrice[]> {
  if (input.lineIds.length === 0) return [];
  const { data, error } = await db.from('price_book_item_usage_prices')
    .select('id, subscription_line_id, meter_id, currency, unit_amount_micros, effective_from, effective_to')
    .eq('organization_id', input.organizationId).in('subscription_line_id', input.lineIds)
    .order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'subscriptions.usage_prices_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    lineId: row.subscription_line_id as string,
    meterId: row.meter_id,
    currency: row.currency,
    unitAmountMicros: Number(row.unit_amount_micros),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  }));
}

const ISSUE_REFUSALS: Record<string, string> = {
  '42501': 'You cannot issue invoices for this subscription.',
  GD002: 'Nothing on this subscription is billed for this period.',
  GD014: 'This invoice request was already used. Start a new one.',
  GD042: 'A line of this subscription has no price for this period.',
  GD046: 'This subscription is billed automatically, so Finance does not invoice it.',
  GD047: 'Every period of this subscription is already invoiced.',
};

/** Invoices the next period of a subscription Finance collects itself. Retrying with the same key returns the same invoice. */
export async function issueSubscriptionInvoice(db: Db, input: { subscriptionId: string; dueAt?: string | null; issuanceKey: string }): Promise<string> {
  await requireActor(db);
  const { data, error } = await db.rpc('issue_subscription_invoice', {
    p_subscription_id: input.subscriptionId,
    p_due_at: (input.dueAt ?? null) as string,
    p_issuance_key: input.issuanceKey,
  });
  if (error) {
    const known = error.code ? ISSUE_REFUSALS[error.code] : undefined;
    if (known) throw new DomainError(known, 'subscriptions.invoice_refused');
    if (error.code === 'GD048' || error.code === '22023') throw new DomainError(error.message, 'subscriptions.invoice_refused');
    throw fromDatabaseError(error, 'subscriptions.invoice_failed');
  }
  return data as string;
}
