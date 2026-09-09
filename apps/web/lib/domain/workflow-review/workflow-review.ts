import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * A public prospect asking GOLD for a workflow review, from the marketing homepage.
 *
 * The same anonymous axis booking uses (D22, I11): sign in anonymously so the write has a real
 * actor, call the one privileged function, then sign out again immediately. Booking keeps its
 * session alive on purpose, so a visitor can come back and see what they booked; this deliberately
 * does not — there is nothing here to come back and read, and the migration
 * (`20260909000001_a_workflow_review_leaves_no_way_back_in.sql`) leaves no select policy that
 * would let this session read anything even if it stayed signed in.
 */
export async function requestWorkflowReview(
  db: Db,
  input: {
    name: string;
    businessName: string;
    email: string;
    phone: string;
    context: string;
    teamSize: string;
    businessType: string;
  },
): Promise<void> {
  const businessName = input.businessName.trim();
  if (businessName.length === 0) {
    throw new DomainError('Please tell us the name of your business.', 'workflow_review.name_required');
  }

  const { data: existing } = await db.auth.getUser();
  if (!existing.user) {
    const { error } = await db.auth.signInAnonymously();
    if (error) {
      throw new DomainError(
        'This form is not available right now. Please try again shortly.',
        'workflow_review.no_session',
      );
    }
  }

  const { error } = await db.rpc('request_workflow_review', {
    p_name: input.name.trim(),
    p_business_name: businessName,
    p_email: input.email.trim(),
    p_phone: input.phone.trim(),
    p_context: input.context.trim(),
    p_team_size: input.teamSize.trim(),
    p_business_type: input.businessType.trim(),
  });

  // Signed out either way: a failed attempt leaves no more of a session behind than a
  // successful one does.
  await db.auth.signOut();

  if (error) {
    if (error.code === 'GD001') {
      throw new DomainError(
        'Workflow reviews are not being accepted on this deployment right now.',
        'workflow_review.not_configured',
      );
    }
    if (error.code === '23514') {
      throw new DomainError('Please tell us the name of your business.', 'workflow_review.name_required');
    }
    throw new DomainError(error.message, 'workflow_review.failed');
  }
}
