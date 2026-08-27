'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { uploadDocument } from '@/lib/domain/documents/documents';
import { DomainError } from '@/lib/domain/errors';

export type UploadState = { error: string | null };

export async function uploadCustomerDocumentAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const customerId = String(formData.get('customerId') ?? '');
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  try {
    // The customer id comes from a hidden field and is deliberately not re-checked here.
    // `documents_customer_same_org` makes a document naming another tenant's customer
    // impossible to write, and the storage policy pins the bytes to this caller's tenant
    // prefix, so tampering produces a refusal rather than a leak.
    await uploadDocument(db, {
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
