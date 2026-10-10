import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { beginBooking, bookSlot, bookableSlots, listBookableTypes, resolveBookingSlug } from '@/lib/domain/booking/booking';
import {
  getInvoiceForWorkItem,
  invoiceStanding,
  issueInvoice,
  listCustomerInvoices,
  listInvoiceLines,
  listPayments,
  recordPayment,
} from '@/lib/domain/billing/invoices';
import { claimPortalInvite, createPortalInvite, revokePortalInvite, listPortalInvites } from '@/lib/domain/portal/portal';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/domain/pricing/price-book';
import { listPricedLines } from '@/lib/domain/pricing/prices';
import { createResource } from '@/lib/domain/resources/resources';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A field-service customer, end to end, through the real operations: a business publishes a
 * bookable service, a stranger books it, the booking becomes a customer, a scheduled work item on
 * a resource and a priced line; the operator invoices it; payments are recorded by hand; a later
 * price change leaves the issued invoice alone; the customer, holding only a portal link, sees
 * their own invoice and nothing else, and loses access when the link is withdrawn.
 *
 * Nothing is inserted behind the application's back, and no money moves: payment here is the
 * manual "write down that money arrived" door, which is a different fact from a processor
 * confirming a card charge (that door is exercised in `portal-payments`).
 */

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ZONE = 'America/Edmonton';
const MONDAY = '2027-03-15';

const client = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function business(label: string) {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = client();
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'CAD', timezone: ZONE });

  const typeId = await createWorkItemType(db, { organizationId, name: 'Mobile brake service', schedulable: true });
  const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Requested' });
  await createResource(db, { organizationId, resourceClass: 'other', name: 'Service van' });
  const priceItemId = await createPriceBookItem(db, { organizationId, name: 'Brake service', unit: 'visit', unitAmountMinor: 18_000 });
  await addOperatingHours(db, { organizationId, dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' });
  await setModuleEnabled(db, { organizationId, key: 'booking', enabled: true });
  await setModuleEnabled(db, { organizationId, key: 'portal', enabled: true });
  await setTypeBookable(db, { id: typeId, statusId, durationMinutes: 60, priceItemId });
  const organization = await getOrganization(db, organizationId);
  await updateOrganization(db, { id: organizationId, name: organization!.name, timezone: organization!.timezone, currency: organization!.currency!, bufferMinutes: organization!.bufferMinutes, slug });
  return { db, organizationId, typeId, statusId, priceItemId, slug };
}

let shop: Awaited<ReturnType<typeof business>>;
let rival: Awaited<ReturnType<typeof business>>;
let workItemId: string;
let customerId: string;
let invoiceId: string;

beforeAll(async () => {
  if (!ANON || !SERVICE) throw new Error('SUPABASE_ANON_KEY and SERVICE_ROLE_KEY must be set.');
  [shop, rival] = await Promise.all([business('fs-shop'), business('fs-rival')]);
}, 120_000);

describe('a public booking becomes the business\'s own work', () => {
  it('resolves the public address to this business only, and grounds times in its own hours', async () => {
    const visitor = client();
    expect(await resolveBookingSlug(visitor, shop.slug)).toBe(shop.organizationId);
    expect(await resolveBookingSlug(visitor, rival.slug)).toBe(rival.organizationId);
    await beginBooking(visitor, { organizationId: shop.organizationId });
    const [type] = await listBookableTypes(visitor, { organizationId: shop.organizationId });
    const slots = await bookableSlots(visitor, { organizationId: shop.organizationId, type, date: MONDAY, timeZone: ZONE });
    // Monday 09:00-12:00, one-hour service: three slots, none outside the business's hours.
    expect(slots).toHaveLength(3);
  });

  it('books through the public door and refuses invalid or taken selections', async () => {
    const visitor = client();
    await beginBooking(visitor, { organizationId: shop.organizationId });
    const [type] = await listBookableTypes(visitor, { organizationId: shop.organizationId });
    const slots = await bookableSlots(visitor, { organizationId: shop.organizationId, type, date: MONDAY, timeZone: ZONE });

    await expect(bookSlot(visitor, { organizationId: shop.organizationId, typeId: type.id, slot: slots[0], name: '', email: 'x@example.test', phone: '' })).rejects.toMatchObject({ code: 'booking.name_required' });
    await expect(bookSlot(visitor, { organizationId: shop.organizationId, typeId: type.id, slot: slots[0], name: 'No Contact', email: '', phone: '' })).rejects.toMatchObject({ code: 'booking.contact_required' });
    // A time the business never offered (03:00 local) is refused rather than accepted.
    await expect(bookSlot(visitor, { organizationId: shop.organizationId, typeId: type.id, slot: { startsAt: '2027-03-15T10:00:00.000Z', endsAt: '2027-03-15T11:00:00.000Z' } as never, name: 'Night Owl', email: 'night@example.test', phone: '' })).rejects.toBeInstanceOf(Error);

    workItemId = await bookSlot(visitor, { organizationId: shop.organizationId, typeId: type.id, slot: slots[0], name: 'Marguerite Tremblay', email: 'marguerite@example.test', phone: '' });
    expect(workItemId).toBeTruthy();

    // A second visitor cannot take the same hour.
    const second = client();
    await beginBooking(second, { organizationId: shop.organizationId });
    await expect(bookSlot(second, { organizationId: shop.organizationId, typeId: type.id, slot: slots[0], name: 'Too Late', email: 'late@example.test', phone: '' })).rejects.toBeInstanceOf(Error);

    // And the visitor learned nothing internal along the way. The one thing an external session may
    // read is the customer record and work item its own booking created (the external-axis policy);
    // no other customer or work item, no invoice and no member is visible to it.
    const own = (await visitor.from('customers').select('id,name').eq('organization_id', shop.organizationId)).data ?? [];
    expect(own.map((row) => row.name)).toEqual(['Marguerite Tremblay']);
    expect(((await visitor.from('work_items').select('id').eq('organization_id', shop.organizationId)).data ?? []).map((row) => row.id)).toEqual([workItemId]);
    for (const table of ['invoices', 'memberships', 'brand_settings']) {
      expect((await visitor.from(table).select('id').eq('organization_id', shop.organizationId)).data ?? [], table).toEqual([]);
    }
    expect((await second.from('customers').select('id').eq('organization_id', shop.organizationId)).data ?? []).toEqual([]);
  });

  it('creates the customer, the scheduled work item on a resource, and the priced line', async () => {
    const booked = (await listWorkItems(shop.db, { organizationId: shop.organizationId })).find((item) => item.id === workItemId)!;
    expect(booked.status.id).toBe(shop.statusId);
    expect(booked.customer?.label).toBe('Marguerite Tremblay');
    expect(booked.window).not.toBeNull();
    customerId = booked.customer!.id;
    expect((await listCustomers(shop.db, { organizationId: shop.organizationId })).map((customer) => customer.id)).toContain(customerId);

    const assigned = await shop.db.from('work_item_resource_assignments').select('resource_id').eq('work_item_id', workItemId);
    expect(assigned.data).toHaveLength(1);

    const lines = await listPricedLines(shop.db, { organizationId: shop.organizationId, workItemId });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ unitAmountMinor: 18_000, quantity: 1 });

    // The other business has none of it.
    expect((await listWorkItems(rival.db, { organizationId: rival.organizationId })).some((item) => item.id === workItemId)).toBe(false);
    expect((await rival.db.from('work_items').select('id').eq('id', workItemId)).data ?? []).toEqual([]);
  });
});

describe('fulfilment, invoicing and manual payment', () => {
  it('issues an invoice for the booked work in the business currency', async () => {
    invoiceId = await issueInvoice(shop.db, { workItemId, dueAt: null });
    const invoice = await getInvoiceForWorkItem(shop.db, { organizationId: shop.organizationId, workItemId });
    expect(invoice).toMatchObject({ id: invoiceId, currency: 'CAD' });
    expect(invoiceStanding(invoice!).total?.totalMinor).toBe(18_000);
  });

  it('keeps an issued invoice unchanged when the price book later changes', async () => {
    await updatePriceBookItem(shop.db, { id: shop.priceItemId, organizationId: shop.organizationId, name: 'Brake service', unit: 'visit', unitAmountMinor: 25_000 } as never);
    const lines = await listInvoiceLines(shop.db, { organizationId: shop.organizationId, invoiceId });
    expect(lines.map((line) => line.unitAmountMinor)).toEqual([18_000]);
    const invoice = await getInvoiceForWorkItem(shop.db, { organizationId: shop.organizationId, workItemId });
    expect(invoiceStanding(invoice!).total?.totalMinor).toBe(18_000);
  });

  it('records manual payments and settles by arithmetic, with money in whole minor units', async () => {
    await expect(recordPayment(shop.db, { invoiceId, amountMinor: 12.5 as never })).rejects.toMatchObject({ code: 'payments.amount_not_integer' });
    await recordPayment(shop.db, { invoiceId, amountMinor: 5_000, note: 'Deposit, cash' });
    let invoice = (await getInvoiceForWorkItem(shop.db, { organizationId: shop.organizationId, workItemId }))!;
    expect(invoiceStanding(invoice).settled).toBe(false);
    await recordPayment(shop.db, { invoiceId, amountMinor: 13_000, note: 'Balance, cash' });
    invoice = (await getInvoiceForWorkItem(shop.db, { organizationId: shop.organizationId, workItemId }))!;
    expect(invoiceStanding(invoice).settled).toBe(true);
    const payments = await listPayments(shop.db, { organizationId: shop.organizationId, invoiceId });
    expect(payments.map((payment) => payment.amountMinor).sort((x, y) => x - y)).toEqual([5_000, 13_000]);
    // Manual recording names no processor: that is a different, separately proven fact.
    for (const payment of payments) expect(payment.provider).toBeNull();
  });

  it('refuses to let the other business see or pay this invoice', async () => {
    expect((await rival.db.from('invoices').select('id').eq('id', invoiceId)).data ?? []).toEqual([]);
    await expect(recordPayment(rival.db, { invoiceId, amountMinor: 100 })).rejects.toBeInstanceOf(Error);
  });
});

describe('the customer portal shows a customer only their own records', () => {
  it('lets the invited customer see their invoice, and not the business\'s other customers\'', async () => {
    const otherCustomerId = await createCustomer(shop.db, { organizationId: shop.organizationId, name: 'Someone Else' });
    const token = await createPortalInvite(shop.db, { customerId });
    const portal = client();
    await claimPortalInvite(portal, { token });

    const mine = await listCustomerInvoices(portal, { organizationId: shop.organizationId, customerId });
    expect(mine.map((invoice) => invoice.id)).toEqual([invoiceId]);
    const theirs = await listCustomerInvoices(portal, { organizationId: shop.organizationId, customerId: otherCustomerId });
    expect(theirs).toEqual([]);
    // The portal session is not a business session: internal tables stay closed.
    expect((await portal.from('memberships').select('id').eq('organization_id', shop.organizationId)).data ?? []).toEqual([]);
    expect((await portal.from('work_items').select('id').eq('organization_id', rival.organizationId)).data ?? []).toEqual([]);
  });

  it('ends the customer\'s access when the business withdraws the link', async () => {
    const token = await createPortalInvite(shop.db, { customerId });
    const portal = client();
    await claimPortalInvite(portal, { token });
    expect((await listCustomerInvoices(portal, { organizationId: shop.organizationId, customerId })).length).toBe(1);

    for (const invite of await listPortalInvites(shop.db, { organizationId: shop.organizationId, customerId })) {
      if (!invite.revokedAt) await revokePortalInvite(shop.db, { id: invite.id });
    }
    expect(await listCustomerInvoices(portal, { organizationId: shop.organizationId, customerId })).toEqual([]);
  });
});
