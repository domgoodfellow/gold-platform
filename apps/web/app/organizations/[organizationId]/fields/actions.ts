'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import {
  createFieldDefinition,
  isKind,
  updateFieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { DomainError } from '@/lib/domain/errors';

/** Transport decoding only — whether the list of choices is well-formed is the domain layer's job. Both line endings, since Windows browsers send `\r\n`. */
function optionsFromFormData(formData: FormData): string[] {
  const raw = formData.get('options');
  if (typeof raw !== 'string') return [];
  return raw.split(/\r?\n/);
}

export type CreateFieldState = { error: string | null };

/** Fields also rendered on the Work workspace's own Configure rail need that route revalidated too, or an edit made there would show stale until the next unrelated navigation. */
function revalidateFieldSurfaces(organizationId: string, entityType: string) {
  revalidatePath(`/organizations/${organizationId}/fields`);
  if (entityType === 'work_item') {
    revalidatePath(`/organizations/${organizationId}/work`);
    revalidatePath(`/organizations/${organizationId}/settings/work`);
  }
}

export async function createFieldAction(
  _previous: CreateFieldState,
  formData: FormData,
): Promise<CreateFieldState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const entityType = String(formData.get('entityType') ?? '');

  try {
    await createFieldDefinition(db, {
      organizationId,
      entityType,
      key: String(formData.get('key') ?? ''),
      label: String(formData.get('label') ?? ''),
      kind: String(formData.get('kind') ?? ''),
      required: formData.get('required') !== null,
      options: optionsFromFormData(formData),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  // The organization id comes from a hidden field a client could edit, and it's deliberately not
  // re-checked here — `field_definitions_insert` requires membership and `field.manage`, so
  // tampering produces a refusal rather than a leak.
  revalidateFieldSurfaces(organizationId, entityType);
  return { error: null };
}

export type UpdateFieldState = { error: string | null };

/** No writable `kind` or `key` — the column grant refuses both to every caller. `kind` is still read, so a value naming no kind fails with a sentence rather than a type assertion. */
export async function updateFieldAction(
  _previous: UpdateFieldState,
  formData: FormData,
): Promise<UpdateFieldState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const kind = String(formData.get('kind') ?? '');

  if (!isKind(kind)) {
    return { error: `Not a field type: ${kind}.` };
  }

  try {
    await updateFieldDefinition(db, {
      id: String(formData.get('fieldId') ?? ''),
      label: String(formData.get('label') ?? ''),
      required: formData.get('required') !== null,
      position: Number(formData.get('position') ?? ''),
      kind,
      options: optionsFromFormData(formData),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidateFieldSurfaces(organizationId, String(formData.get('entityType') ?? ''));
  return { error: null };
}
