'use server';

import { revalidatePath } from 'next/cache';
import { getProposalDb } from '@/lib/db/proposal-server';
import {
  acceptCommercialProposal,
  declineCommercialProposal,
} from '@/lib/domain/customers/commercial-proposals';
import { requireProposalAccessContext } from '@/lib/domain/customers/proposal-access';
import { DomainError } from '@/lib/domain/errors';

export type RespondToProposalState = { error: string | null };

/**
 * Accept, as the recipient this proposal was sent to. What gets recorded as accepted is this
 * proposal's own `proposed_configuration` snapshot, copied server-side inside
 * `accept_commercial_proposal` itself (C1 closeout) — this action supplies nothing but which
 * version was shown. Who is answering (organization, customer) comes from the proposal session,
 * never from the form, and the function refuses a version that is not this recipient's, is not
 * open, or has been replaced by a newer one.
 */
export async function acceptProposalAction(
  _previous: RespondToProposalState,
  formData: FormData,
): Promise<RespondToProposalState> {
  const db = await getProposalDb();
  const proposalId = String(formData.get('proposalId') ?? '');

  try {
    await requireProposalAccessContext(db);
    await acceptCommercialProposal(db, { proposalId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath('/proposal');
  return { error: null };
}

export async function declineProposalAction(
  _previous: RespondToProposalState,
  formData: FormData,
): Promise<RespondToProposalState> {
  const db = await getProposalDb();
  const proposalId = String(formData.get('proposalId') ?? '');

  try {
    await requireProposalAccessContext(db);
    await declineCommercialProposal(db, { proposalId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath('/proposal');
  return { error: null };
}
