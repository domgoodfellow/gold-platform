'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { uploadImportFile } from '@/lib/domain/integrations/resources';
import {
  createMapping,
  prepareImportFields,
  type MappingField,
  type MappingFieldTransform,
  type MappingTarget,
} from '@/lib/domain/integrations/mappings';
import { beginImportRun, requireImportPipeline, resumeImportStaging } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { libraryImportHref, libraryNewImportHref } from '@/lib/route/library';

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
    await requireImportPipeline(db);
    const uploaded = await uploadImportFile(db, { organizationId, file });
    resourceId = uploaded.resourceId;
    await prepareImportFields(db, organizationId, uploaded.parsed.headers);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  redirect(libraryNewImportHref(organizationId, resourceId));
}

function parseTarget(value: string): MappingTarget {
  if (value.startsWith('core:')) {
    return { kind: 'core', field: value.slice(5) as 'name' | 'email' | 'phone' };
  }
  if (value.startsWith('custom:')) {
    return { kind: 'custom', key: value.slice(7) };
  }
  if (value.startsWith('location:') && ['address', 'city', 'province'].includes(value.slice(9))) {
    return { kind: 'location', field: value.slice(9) as 'address' | 'city' | 'province' };
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

  const backTo = libraryNewImportHref(organizationId, resourceId);

  let runId: string | undefined;
  try {
    const mappingId = await createMapping(db, {
      organizationId,
      resourceId,
      fields,
      dedupeKey: null,
    });

    runId = await beginImportRun(db, { organizationId, mappingId });

    await resumeImportStaging(db, { organizationId, runId });
  } catch (error) {
    if (error instanceof DomainError) {
      if (runId) redirect(libraryImportHref(organizationId, runId, `?stageError=${encodeURIComponent(error.message)}`));
      redirect(`${backTo}&error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  redirect(libraryImportHref(organizationId, runId));
}
