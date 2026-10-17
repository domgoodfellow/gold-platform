'use server';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { createPortalInvite, revokePortalInvite } from '@/lib/domain/portal/portal';
import { updateCustomer } from '@/lib/domain/customers/customers';
import {
  upsertDiscoverySnapshotAnswers,
  type DiscoveryAnswerPatch,
} from '@/lib/domain/customers/discovery-snapshots';
import { DISCOVERY_REQUIREMENTS } from '@/lib/domain/customers/discovery-requirements';
import { buildCommercialProposal, markCommercialProposalSent } from '@/lib/domain/customers/commercial-proposals';
import { createProposalInvite } from '@/lib/domain/customers/proposal-invites';
import { handoffAcceptedProposal } from '@/lib/domain/customers/proposal-handoff';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { uploadDocument } from '@/lib/domain/documents/documents';
import { DomainError } from '@/lib/domain/errors';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import { requireOrganization } from '@/lib/route/organization';

export async function uploadCustomerDocumentAction(
  _previous: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  try {
    // The customer id comes from a hidden field and is deliberately not re-checked here.
    // `document_links_customer_same_org` makes a link naming another tenant's customer
    // impossible to write, and the storage policy pins the bytes to this caller's tenant
    // prefix, so tampering produces a refusal rather than a leak.
    await uploadDocument(db, { files: supabaseFileStore(db, BUCKET),
      organizationId,
      attachedTo: { entity: 'customer', id: customerId },
      file,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null };
}

/**
 * Make a portal link for this customer.
 *
 * The token comes back once through the action's own state rather than being written into the
 * page, because it is a credential the operator is about to send somewhere. It is stored, so a
 * business that loses it can read it again from its own list — this is a shareable link and
 * treating it as a password would protect nothing.
 */
export async function createPortalInviteAction(
  _previous: { error: string | null; token: string | null },
  formData: FormData,
): Promise<{ error: string | null; token: string | null }> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');

  let token: string;
  try {
    token = await createPortalInvite(db, { customerId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, token: null };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null, token };
}

/**
 * Withdraw one of this customer's portal links.
 *
 * `revokePortalInvite` now raises rather than silently touching zero rows when the caller lacks
 * `customer.create` or the id belongs to another organization's invite — see its own comment.
 */
export async function revokePortalInviteAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');

  try {
    await revokePortalInvite(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null };
}

export type EditCustomerState = { error: string | null; updated: boolean };

/**
 * Correct a customer, and move them along their pipeline.
 *
 * **The stage arrives on the same form as the phone number on purpose.** They are one record and
 * one act — a rep who has just spoken to somebody fixes the number they were given and moves the
 * deal in the same breath, and two forms would mean two saves and two chances to do only one.
 */
export async function editCustomerAction(
  _previous: EditCustomerState,
  formData: FormData,
): Promise<EditCustomerState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');
  const stageId = String(formData.get('stageId') ?? '');

  // **Was a hand-written copy of `customValuesFromFormData`, and its own comment said so** —
  // "one prefix, two callers" was the argument for extracting it rather than for writing it
  // twice. It is called now, because the shared one learned that a repeated name is a list and
  // this one had not: a `multi_select` submitted through this form kept one choice out of four
  // and reported success. A copy is wrong the moment the original learns something.
  const custom = customValuesFromFormData(formData);

  try {
    await updateCustomer(db, {
      organizationId,
      customerId,
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      custom,
      // An empty select is "no stage", which is a real answer for a business that has named
      // none and for a customer nobody has staged yet.
      stageId: stageId === '' ? null : stageId,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, updated: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  revalidatePath(`/organizations/${organizationId}/customers`);
  revalidatePath(`/organizations/${organizationId}/customers/pipeline`);
  revalidatePath(`/organizations/${organizationId}/sales`);
  return { error: null, updated: true };
}

export type EditDiscoverySnapshotState = { error: string | null; updated: boolean };

/**
 * Save whatever a discovery conversation covered.
 *
 * Every requirement on the form is the new value, including the ones left blank — the same
 * reason `editCustomerAction` submits the whole record: a form has no way to say *leave this
 * alone* that is distinguishable from *nothing was said here*, and clearing an answer is a real
 * edit a salesperson makes.
 *
 * A typed value saved through this form is always `confirmed`: a person here read it and is the
 * one typing it in, whether it started blank, from a prospect's own words at intake, or from a
 * conversation — status only ever moves forward from a public form's `provided` once a person
 * here has looked at it. A requirement whose "Not applicable" box is ticked is `not_applicable`
 * regardless of what its textarea holds — the checkbox is the answer, not the text beside it.
 */
export async function editDiscoverySnapshotAction(
  _previous: EditDiscoverySnapshotState,
  formData: FormData,
): Promise<EditDiscoverySnapshotState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const { organization } = await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');

  const patch: DiscoveryAnswerPatch = {};
  for (const requirement of DISCOVERY_REQUIREMENTS) {
    const notApplicable = formData.get(`${requirement.key}__na`) === 'on';
    patch[requirement.key] = notApplicable
      ? { value: '', status: 'not_applicable', source: organization.role }
      : { value: String(formData.get(requirement.key) ?? '').trim(), status: 'confirmed', source: organization.role };
  }

  try {
    await upsertDiscoverySnapshotAnswers(db, { organizationId, customerId, patch });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, updated: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null, updated: true };
}

export type BuildCommercialProposalState = { error: string | null; created: boolean };

export async function buildCommercialProposalAction(
  _previous: BuildCommercialProposalState,
  formData: FormData,
): Promise<BuildCommercialProposalState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');
  const discountMinor = Number(formData.get('discountMinor') ?? 0);

  try {
    await buildCommercialProposal(db, {
      organizationId,
      customerId,
      planId: String(formData.get('planId') ?? ''),
      addonPlanIds: formData.getAll('addonPlanIds').map(String),
      currency: String(formData.get('currency') ?? ''),
      billingInterval: String(formData.get('billingInterval') ?? 'month') as 'month' | 'year' | 'one_time',
      discountMinor: Number.isFinite(discountMinor) ? discountMinor : 0,
      discountReason: String(formData.get('discountReason') ?? ''),
      notes: String(formData.get('notes') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, created: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null, created: true };
}

export type SendCommercialProposalState = { error: string | null };

export async function sendCommercialProposalAction(
  _previous: SendCommercialProposalState,
  formData: FormData,
): Promise<SendCommercialProposalState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');

  try {
    await markCommercialProposalSent(db, { organizationId, proposalId });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null };
}

export type SendProposalInviteState = { error: string | null; url: string | null };

export async function sendProposalInviteAction(
  _previous: SendProposalInviteState,
  formData: FormData,
): Promise<SendProposalInviteState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');

  try {
    await createProposalInvite(db, { customerId });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, url: null };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null, url: null };
}

export type HandoffProposalState = { error: string | null; createdOrganizationId: string | null };

/**
 * "Create this business in GildOps" — the terminal act of the commercial funnel. Real
 * authorization is `provision_organization`'s own live platform_staff check; this action does
 * not attempt to gate it a second time, since a client-side guard would only be a courtesy.
 */
export async function handoffProposalAction(
  _previous: HandoffProposalState,
  formData: FormData,
): Promise<HandoffProposalState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');

  let createdOrganizationId: string;
  try {
    const handoff = await handoffAcceptedProposal(db, { organizationId, proposalId });
    createdOrganizationId = handoff.createdOrganizationId;
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, createdOrganizationId: null };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null, createdOrganizationId };
}
