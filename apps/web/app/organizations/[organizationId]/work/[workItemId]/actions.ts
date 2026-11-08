'use server';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

import { revalidatePath } from 'next/cache';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requestOrigin } from '@/lib/route/origin';
import { requestCardPayment } from '@/lib/domain/billing/card-payments';
import { addChecklistItem, setChecklistItemDone } from '@/lib/domain/work-items/checklists';
import { removePricedLine } from '@/lib/domain/pricing/prices';
import { recordCost, recordTime } from '@/lib/domain/work-items/consumption';
import { updateWorkItem } from '@/lib/domain/work-items/work-items';
import { uploadDocument } from '@/lib/domain/documents/documents';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import { requireOrganization } from '@/lib/route/organization';

export type WorkItemActionState = { error: string | null };

/**
 * The card path's own state, because it has an answer as well as an error.
 *
 * A separate type rather than a nullable field on `WorkItemActionState`: every other action on
 * this page succeeds by changing the database and re-rendering, and this one succeeds by
 * handing back somewhere to go.
 */
export type CardPaymentActionState = { error: string | null; payUrl: string | null };

/**
 * The details Sheet's own state, because it needs to know when it succeeded in order to close
 * itself — the same reasoning `CardPaymentActionState` rests on, one line up.
 */
export type UpdateWorkItemState = { error: string | null; updated: boolean };

function revalidate(organizationId: string, workItemId: string) {
  revalidatePath(`/organizations/${organizationId}/work/${workItemId}`);
  revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
}

export async function addChecklistItemAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
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
  await requireOrganization(organizationId);
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    // Who ticked it is not submitted. The policy pins `done_by` to `auth.uid()`, so a forged
    // field would be refused by the database rather than trusted here.
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
  await requireOrganization(organizationId);
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
  await requireOrganization(organizationId);
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

export async function removePricedLineAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
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
  _previous: UpdateWorkItemState,
  formData: FormData,
): Promise<UpdateWorkItemState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
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
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null, updated: true };
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
  await requireOrganization(organizationId);
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    const requested = await requestCardPayment(db, {
      organizationId,
      workItemId,
      // A path this application owns, built here rather than accepted from the form. *Never
      // build an open redirector*: the destination resolves against routes we control, and a
      // submitted `returnUrl` is exactly the field that rule exists to refuse.
      returnUrl: `${await requestOrigin()}/organizations/${organizationId}/work/${workItemId}`,
    });

    if (!requested) {
      return { error: 'Card payments aren’t set up for this business.', payUrl: null };
    }

    revalidate(organizationId, workItemId);
    return { error: null, payUrl: requested.payUrl };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, payUrl: null };
    throw error;
  }
}

export async function uploadWorkItemDocumentAction(
  _previous: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const workItemId = String(formData.get('workItemId') ?? '');
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  try {
    // Not re-checked here: the composite FK on `document_links.work_item_id` makes a link
    // naming another tenant's job impossible to write, the same guarantee every other
    // attachment action in this codebase rests on.
    await uploadDocument(db, { files: supabaseFileStore(db, BUCKET),
      organizationId,
      attachedTo: { entity: 'work_item', id: workItemId },
      file,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}
