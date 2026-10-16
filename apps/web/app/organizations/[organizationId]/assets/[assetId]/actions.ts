'use server';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordAssetReading } from '@/lib/domain/assets/readings';
import { uploadDocument } from '@/lib/domain/documents/documents';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import { requireOrganization } from '@/lib/route/organization';

export type AssetActionState = { error: string | null };

function revalidate(organizationId: string, assetId: string) {
  revalidatePath(`/organizations/${organizationId}/assets/${assetId}`);
}

export async function recordReadingAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const assetId = String(formData.get('assetId') ?? '');

  try {
    await recordAssetReading(db, {
      organizationId,
      assetId,
      value: Number(formData.get('value') ?? Number.NaN),
      unit: String(formData.get('unit') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, assetId);
  return { error: null };
}

export async function uploadAssetDocumentAction(
  _previous: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const assetId = String(formData.get('assetId') ?? '');
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  try {
    // The asset id comes from a hidden field and is deliberately not re-checked here — the
    // same composite-FK argument `uploadCustomerDocumentAction` rests on: a document naming
    // another tenant's asset is impossible to write, so tampering is refused, not leaked.
    await uploadDocument(db, { files: supabaseFileStore(db, BUCKET),
      organizationId,
      attachedTo: { entity: 'asset', id: assetId },
      file,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, assetId);
  return { error: null };
}
