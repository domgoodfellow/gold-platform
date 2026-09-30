'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import {
  acceptCommercialProposal,
  declineCommercialProposal,
} from '@/lib/domain/customers/commercial-proposals';
import { DomainError } from '@/lib/domain/errors';

export type RespondToProposalState = { error: string | null };

/**
 * Accept, as the customer this proposal was sent to. What gets recorded as accepted is this
 * proposal's own `proposed_configuration` snapshot, copied server-side inside
 * `accept_commercial_proposal` itself (C1 closeout) — this action supplies nothing but which
 * proposal, so there is no configuration value here for a request to shape.
 */
export async function acceptProposalAction(
  _previous: RespondToProposalState,
  formData: FormData,
): Promise<RespondToProposalState> {
  const db = await getDb();
  const token = String(formData.get('token') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');

  try {
    await acceptCommercialProposal(db, { proposalId });
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
