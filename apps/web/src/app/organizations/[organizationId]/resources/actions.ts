'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { DomainError } from '@/lib/domain/errors';
import { createResource } from '@/lib/domain/resources/resources';

export type CreateResourceState = { error: string | null };

export async function createResourceAction(
  _previous: CreateResourceState,
  formData: FormData,
): Promise<CreateResourceState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await createResource(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      custom: customValuesFromFormData(formData),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  // The organization id comes from a hidden field and is deliberately not re-checked here:
  // `resources_insert` requires both membership and resource.create, so tampering produces
  // a refusal rather than a leak.
  revalidatePath(`/organizations/${organizationId}/resources`);
  return { error: null };
}
