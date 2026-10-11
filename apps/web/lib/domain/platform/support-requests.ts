import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * A business operator asking GildOps for help. This is the provider's intake, not a Support case:
 * Support is a business serving its own customers. Writing a request gives GildOps staff nothing
 * they did not have — a platform support session is still the only way into a tenant — and the
 * request carries only who asked, for which business, what they typed and the page they came from.
 */
const SUBJECT_MAX = 200;
const MESSAGE_MAX = 5000;

export async function contactGildopsSupport(
  db: Db,
  input: { organizationId: string; subject: string; message: string; page?: string | null },
): Promise<string> {
  await requireActor(db);

  const subject = input.subject.trim();
  const message = input.message.trim();
  if (subject.length === 0) throw new DomainError('Add a short subject.', 'support_request.subject_required');
  if (subject.length > SUBJECT_MAX) throw new DomainError(`Keep the subject under ${SUBJECT_MAX} characters.`, 'support_request.subject_too_long');
  if (message.length === 0) throw new DomainError('Describe what you need help with.', 'support_request.message_required');
  if (message.length > MESSAGE_MAX) throw new DomainError(`Keep the message under ${MESSAGE_MAX} characters.`, 'support_request.message_too_long');

  const { data, error } = await db.rpc('contact_gildops_support', {
    p_organization_id: input.organizationId,
    p_subject: subject,
    p_message: message,
    ...(input.page ? { p_page: input.page } : {}),
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You can only contact GildOps Support about a business you belong to.', 'support_request.forbidden');
    }
    throw new DomainError('That request could not be sent. Please try again.', 'support_request.failed');
  }

  return data;
}
