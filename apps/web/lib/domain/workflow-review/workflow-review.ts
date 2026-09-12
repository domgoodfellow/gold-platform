import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { WORKFLOW_REVIEW_LIMITS } from './limits';

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
  const normalized = {
    name: input.name.trim(),
    businessName: input.businessName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    context: input.context.trim(),
    teamSize: input.teamSize.trim(),
    businessType: input.businessType.trim(),
  };
  const businessName = normalized.businessName;
  if (businessName.length === 0) {
    throw new DomainError('Please tell us the name of your business.', 'workflow_review.name_required');
  }

  for (const [field, maximum] of Object.entries(WORKFLOW_REVIEW_LIMITS)) {
    if (normalized[field as keyof typeof normalized].length > maximum) {
      throw new DomainError(
        `That ${field === 'businessName' ? 'business name' : field} is too long.`,
        'workflow_review.field_too_long',
      );
    }
  }

  if (normalized.email.length > 0 && !normalized.email.includes('@')) {
    throw new DomainError('That email address is not valid.', 'workflow_review.email_invalid');
  }
  if (normalized.phone.length > 0 && normalized.phone.length < 3) {
    throw new DomainError('That phone number is not valid.', 'workflow_review.phone_invalid');
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
    p_name: normalized.name,
    p_business_name: businessName,
    p_email: normalized.email,
    p_phone: normalized.phone,
    p_context: normalized.context,
    p_team_size: normalized.teamSize,
    p_business_type: normalized.businessType,
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
