'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { downloadImportFile, uploadImportFile } from '@/lib/domain/integrations/resources';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import {
  createMapping,
  type MappingField,
  type MappingFieldTransform,
  type MappingTarget,
} from '@/lib/domain/integrations/mappings';
import { beginImportRun, stageRows } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';

export type UploadState = { error: string | null };

export async function uploadSourceAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  let resourceId: string;
  try {
    const uploaded = await uploadImportFile(db, { organizationId, file });
    resourceId = uploaded.resourceId;
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  redirect(`/organizations/${organizationId}/integrations/imports/new?resourceId=${resourceId}`);
}

function parseTarget(value: string): MappingTarget {
  if (value.startsWith('core:')) {
    return { kind: 'core', field: value.slice(5) as 'name' | 'email' | 'phone' };
  }
  if (value.startsWith('custom:')) {
    return { kind: 'custom', key: value.slice(7) };
  }
  return { kind: 'ignore' };
}

export async function createMappingAndStageAction(formData: FormData): Promise<void> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const resourceId = String(formData.get('resourceId') ?? '');
  const headers = formData.getAll('header').map(String);

  const fields: MappingField[] = headers.map((header, index) => ({
    sourceColumn: header,
    target: parseTarget(String(formData.get(`target_${index}`) ?? 'ignore')),
    transform: (String(formData.get(`transform_${index}`) ?? 'none') as MappingFieldTransform),
  }));

  const backTo = `/organizations/${organizationId}/integrations/imports/new?resourceId=${resourceId}`;

  let runId: string;
  try {
    const mappingId = await createMapping(db, {
      organizationId,
      resourceId,
      fields,
      dedupeKey: 'email',
    });

    runId = await beginImportRun(db, { organizationId, mappingId });

    const parsed = await downloadImportFile(db, { organizationId, resourceId });
    if (!parsed) {
      throw new DomainError('That file is no longer available. Upload it again.', 'integrations.file_missing');
    }

    const definitions = await listFieldDefinitions(db, { organizationId, entityType: 'customer' });

    await stageRows(db, {
      organizationId,
      runId,
      mapping: fields,
      fieldDefinitions: definitions,
      sourceRows: parsed.rows.map((raw, index) => ({ key: `row-${index}`, raw })),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      redirect(`${backTo}&error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  redirect(`/organizations/${organizationId}/integrations/imports/${runId}`);
}
