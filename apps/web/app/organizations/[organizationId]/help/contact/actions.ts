'use server';

import { DomainError } from '@/lib/domain/errors';
import { contactGildopsSupport } from '@/lib/domain/platform/support-requests';
import { safeAppReturnPath } from '@/lib/route/app-return';
import { requireOrganization } from '@/lib/route/organization';

export type ContactSupportState = { error: string | null; sent: boolean };

export async function contactSupportAction(
  _previous: ContactSupportState,
  formData: FormData,
): Promise<ContactSupportState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  // Membership is proved before anything is written; the database policy proves it again.
  const { db } = await requireOrganization(organizationId);

  try {
    await contactGildopsSupport(db, {
      organizationId,
      subject: String(formData.get('subject') ?? ''),
      message: String(formData.get('message') ?? ''),
      // Only a page of this business is recorded; anything else the browser sent is dropped.
      page: safeAppReturnPath(String(formData.get('page') ?? ''), organizationId),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, sent: false };
    throw error;
  }

  return { error: null, sent: true };
}
