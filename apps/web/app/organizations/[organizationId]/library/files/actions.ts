'use server';

import { revalidatePath } from 'next/cache';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';
import { BUCKET, uploadDocument } from '@/lib/domain/documents/documents';
import { DomainError } from '@/lib/domain/errors';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import { requireOrganization } from '@/lib/route/organization';

/**
 * Adds a file to the Library. It is not attached to a record, so it belongs to the business and is
 * available to every workspace. The permission is checked here for a clear message, and again by the
 * database when the row is written.
 */
export async function uploadLibraryFileAction(
  _previous: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const { db, organization } = await requireOrganization(organizationId);

  if (!organization.capabilities.includes('document.create')) {
    return { error: 'You cannot add files to the Library.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  try {
    await uploadDocument(db, { files: supabaseFileStore(db, BUCKET), organizationId, file });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/library/files`);
  return { error: null };
}
