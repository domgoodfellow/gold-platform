'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import {
  acceptCommercialProposal,
  declineCommercialProposal,
} from '@/lib/domain/customers/commercial-proposals';
import { recommendConfiguration } from '@/lib/domain/customers/configuration-recommendation';
import { getDiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import { DomainError } from '@/lib/domain/errors';

export type RespondToProposalState = { error: string | null };

/**
 * Accept, as the customer this proposal was sent to. The recommended configuration is computed
 * here, under this same session, from the discovery snapshot it can already read — a receipt of
 * what this page showed, not a value the form itself supplies (I19: the read is the permission
 * check, so the compute happens on the same side of it).
 */
export async function acceptProposalAction(
  _previous: RespondToProposalState,
  formData: FormData,
): Promise<RespondToProposalState> {
  const db = await getDb();
  const token = String(formData.get('token') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');
  const customerId = String(formData.get('customerId') ?? '');
  const organizationId = String(formData.get('organizationId') ?? '');

  const snapshot = await getDiscoverySnapshot(db, { organizationId, customerId });
  const recommendation = await recommendConfiguration(db, { answers: snapshot?.answers ?? {} });

  try {
    await acceptCommercialProposal(db, { proposalId, acceptedConfiguration: recommendation });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/proposal/${token}`);
  return { error: null };
}

export async function declineProposalAction(
  _previous: RespondToProposalState,
  formData: FormData,
): Promise<RespondToProposalState> {
  const db = await getDb();
  const token = String(formData.get('token') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');

  try {
    await declineCommercialProposal(db, { proposalId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/proposal/${token}`);
  return { error: null };
}
