import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { openPublicSession } from '@/lib/domain/identity/anonymous-session';
import { PUBLIC_INTAKE_LIMITS, type PublicInquiryKind } from './limits';

const FIELD_LABEL: Record<keyof typeof PUBLIC_INTAKE_LIMITS, string> = {
  name: 'name',
  businessName: 'business name',
  email: 'email address',
  phone: 'phone number',
  context: 'message',
  teamSize: 'team size',
  businessType: 'answer',
  topic: 'topic',
};

/**
 * A public visitor writing to GOLD, from the marketing site — either a demo request or a general
 * contact inquiry. One path for both, so neither copies the other's validation or the customer
 * write.
 *
 * The same anonymous axis booking uses (D22, I11): sign in anonymously so the write has a real
 * actor, call the one privileged function, then sign out again immediately. Booking keeps its
 * session alive on purpose, so a visitor can come back and see what they booked; this deliberately
 * does not — there is nothing here to come back and read, and no select policy would let this
 * session read anything even if it stayed signed in (I26).
 */
export async function submitPublicInquiry(
  db: Db,
  input: {
    kind: PublicInquiryKind;
    name: string;
    businessName?: string;
    email: string;
    phone?: string;
    /** The free-text message or context. */
    context?: string;
    teamSize?: string;
    /** What a demo request wants help with. */
    businessType?: string;
    /** What a contact inquiry is about. */
    topic?: string;
  },
): Promise<void> {
  const normalized = {
    name: input.name.trim(),
    businessName: (input.businessName ?? '').trim(),
    email: input.email.trim().toLowerCase(),
    phone: (input.phone ?? '').trim(),
    context: (input.context ?? '').trim(),
    teamSize: (input.teamSize ?? '').trim(),
    businessType: (input.businessType ?? '').trim(),
    topic: (input.topic ?? '').trim(),
  };

  if (input.kind === 'demo' && normalized.businessName.length === 0) {
    throw new DomainError('Please tell us the name of your business.', 'public_intake.name_required');
  }
  if (input.kind === 'contact') {
    if (normalized.name.length === 0) {
      throw new DomainError('Please tell us your name.', 'public_intake.name_required');
    }
    // A general inquiry has to be answerable; a demo request may come with a phone instead.
    if (normalized.email.length === 0) {
      throw new DomainError('Please give us an email address to reply to.', 'public_intake.email_required');
    }
    if (normalized.context.length === 0) {
      throw new DomainError('Please write a message.', 'public_intake.message_required');
    }
  }

  for (const [field, maximum] of Object.entries(PUBLIC_INTAKE_LIMITS)) {
    if (normalized[field as keyof typeof normalized].length > maximum) {
      throw new DomainError(`That ${FIELD_LABEL[field as keyof typeof FIELD_LABEL]} is too long.`, 'public_intake.field_too_long');
    }
  }

  if (normalized.email.length > 0 && !normalized.email.includes('@')) {
    throw new DomainError('That email address is not valid.', 'public_intake.email_invalid');
  }
  if (normalized.phone.length > 0 && normalized.phone.length < 3) {
    throw new DomainError('That phone number is not valid.', 'public_intake.phone_invalid');
  }

  const session = await openPublicSession(db);
  if (!session.ok) {
    throw new DomainError('This form is not available right now. Please try again shortly.', 'public_intake.no_session');
  }

  const { error } = await db.rpc('submit_public_inquiry', {
    p_kind: input.kind,
    p_name: normalized.name,
    p_business_name: normalized.businessName,
    p_email: normalized.email,
    p_phone: normalized.phone,
    p_context: normalized.context,
    p_team_size: normalized.teamSize,
    p_business_type: normalized.businessType,
    p_topic: normalized.topic,
  });

  // Ended either way — a failed attempt leaves no more of a session behind than a successful one —
  // but only if this call began it; somebody already signed in stays signed in.
  await session.end();

  if (error) {
    if (error.code === 'GD001') {
      throw new DomainError('This form is not accepting messages on this deployment right now.', 'public_intake.not_configured');
    }
    if (error.code === '23514') {
      throw new DomainError('Please tell us your name.', 'public_intake.name_required');
    }
    throw new DomainError(error.message, 'public_intake.failed');
  }
}
