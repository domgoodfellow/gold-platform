'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requestCardPayment } from '@/lib/domain/billing/card-payments';
import { issueInvoice, recordPayment } from '@/lib/domain/billing/invoices';
import { addChecklistItem, setChecklistItemDone } from '@/lib/domain/work-items/checklists';
import { addPricedLine, removePricedLine } from '@/lib/domain/pricing/prices';
import { recordCost, recordTime } from '@/lib/domain/work-items/consumption';
import { updateWorkItem } from '@/lib/domain/work-items/work-items';

export type WorkItemActionState = { error: string | null };

/**
 * The card path's own state, because it has an answer as well as an error.
 *
 * A separate type rather than a nullable field on `WorkItemActionState`: every other action on
 * this page succeeds by changing the database and re-rendering, and this one succeeds by
 * handing back somewhere to go.
 */
export type CardPaymentActionState = { error: string | null; payUrl: string | null };

function revalidate(organizationId: string, workItemId: string) {
  revalidatePath(`/organizations/${organizationId}/work/${workItemId}`);
}

export async function addChecklistItemAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    await addChecklistItem(db, {
      workItemId,
      label: String(formData.get('label') ?? ''),
      position: Number(formData.get('position') ?? 0),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function setChecklistItemDoneAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    // Who ticked it is not submitted. The policy pins `done_by` to `auth.uid()`, so a forged
    // field would be refused by the database rather than trusted here (I11).
    await setChecklistItemDone(db, {
      checklistItemId: String(formData.get('checklistItemId') ?? ''),
      done: formData.get('done') === '1',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function recordTimeAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    await recordTime(db, {
      workItemId,
      resourceId: String(formData.get('resourceId') ?? ''),
      startedAt: String(formData.get('startedAt') ?? ''),
      endedAt: String(formData.get('endedAt') ?? ''),
      note: String(formData.get('note') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function recordCostAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    // Minor units all the way to the database. The form asks for them explicitly rather than
    // accepting "12.50" and multiplying, because that multiplication is where a rounding bug
    // gets introduced and then rediscovered in a reconciliation months later.
    await recordCost(db, {
      workItemId,
      description: String(formData.get('description') ?? ''),
      amountMinor: Number(formData.get('amountMinor') ?? Number.NaN),
      // Empty is falsy and becomes null in the domain layer, which leaves the date to the
      // database. An unfilled date field must mean "now", never midnight of some day this
      // process guessed at from its own clock.
      incurredAt: String(formData.get('incurredAt') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

/**
 * Put a catalogue item on this job.
 *
 * Notice what this form cannot submit: an amount. The domain layer takes an item and a
 * quantity, and the RPC copies the price from the catalogue — so there is no field here for
 * somebody to type a number into, which is the difference between quoting and invoicing.
 */
export async function addPricedLineAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    await addPricedLine(db, {
      workItemId,
      priceBookItemId: String(formData.get('priceBookItemId') ?? ''),
      quantity: Number(formData.get('quantity') ?? Number.NaN),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function removePricedLineAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    await removePricedLine(db, { id: String(formData.get('lineId') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function updateWorkItemAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    // Neither the status nor the resource is submitted, and their absence is the guard's
    // shape rather than an oversight: those are `work_item.transition` and
    // `work_item.schedule`, they have their own forms on this page, and the column grant
    // would refuse them from here even if the form carried them.
    await updateWorkItem(db, {
      organizationId,
      id: workItemId,
      title: String(formData.get('title') ?? ''),
      customerId: String(formData.get('customerId') ?? ''),
      locationId: String(formData.get('locationId') ?? ''),
      assetId: String(formData.get('assetId') ?? ''),
      custom: customValuesFromFormData(formData),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

/**
 * Issue the invoice for this job.
 *
 * Notice what this form cannot submit either, and it is more than the priced-line form
 * withholds: no amount, no lines, no currency and no number. `issue_invoice` copies the quote
 * and takes the next number for the business, so the only thing a person chooses here is when
 * it falls due. An invoice whose contents a caller could assert would not be a snapshot.
 */
export async function issueInvoiceAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    await issueInvoice(db, {
      workItemId,
      issuedAt: String(formData.get('issuedAt') ?? ''),
      dueAt: String(formData.get('dueAt') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function recordPaymentAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    // Minor units, for the reason `recordCostAction` gives. No provider field exists on this
    // form and none may be added: this path is a person writing down what they were handed,
    // and a payment that names a processor must have come from one.
    await recordPayment(db, {
      invoiceId: String(formData.get('invoiceId') ?? ''),
      amountMinor: Number(formData.get('amountMinor') ?? Number.NaN),
      receivedAt: String(formData.get('receivedAt') ?? ''),
      note: String(formData.get('note') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

/**
 * Ask the processor to collect what is still owed.
 *
 * **The amount is not submitted and cannot be.** `requestCardPayment` reads the outstanding
 * figure from `invoiceStanding`, which is `priceWorkItem` minus what has arrived — so a form
 * cannot ask a customer for a number nothing in this system stands behind.
 *
 * Returns a URL rather than redirecting from the domain layer, so the one place a caller is
 * sent off this platform stays in the caller.
 */
export async function requestCardPaymentAction(
  _previous: CardPaymentActionState,
  formData: FormData,
): Promise<CardPaymentActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    const requested = await requestCardPayment(db, {
      organizationId,
      workItemId,
      // A path this application owns, built here rather than accepted from the form. *Never
      // build an open redirector*: the destination resolves against routes we control, and a
      // submitted `returnUrl` is exactly the field that rule exists to refuse.
      returnUrl: `${await origin()}/organizations/${organizationId}/work/${workItemId}`,
    });

    if (!requested) {
      return { error: 'This business has no card processor configured.', payUrl: null };
    }

    revalidate(organizationId, workItemId);
    return { error: null, payUrl: requested.payUrl };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, payUrl: null };
    throw error;
  }
}

/** Where this deployment is reachable, for a round trip that has to come back. */
async function origin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}
