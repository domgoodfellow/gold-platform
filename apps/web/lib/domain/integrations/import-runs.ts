import type { Db } from '@/lib/db/types';
import { createHash } from 'node:crypto';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { importValue, normalizeImportRow, type MappingField } from '@/lib/domain/integrations/mappings';

import { IMPORT_BATCH_SIZE } from './import-policy';
import { downloadImportFile } from './resources';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';

export async function requireImportPipeline(db: Db): Promise<void> {
  const result = await db.rpc('import_pipeline_version');
  if (result.error || result.data !== 2) {
    throw new DomainError('Prospect import needs its database update before it can run. Ask the operator to apply the approved import migration.', 'integrations.pipeline_unavailable');
  }
}

export function sourceRowsForImport(rows: Record<string, string>[], sourceName: string) {
  const namespace = createHash('sha256').update(sourceName).digest('hex');
  return rows.map((raw) => {
    const id = importValue(raw.__source_record_id ?? raw.source_record_id);
    const fingerprint = createHash('sha256').update(JSON.stringify(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
    return { key: `${namespace}:${id ? `id:${id}` : `row:${fingerprint}`}`, raw };
  });
}

export async function resumeImportStaging(db: Db, input: { organizationId: string; runId: string }): Promise<number> {
  await requireActor(db);
  const { data: run, error } = await db.from('import_runs').select('resource_id,mapping_snapshot,status')
    .eq('organization_id', input.organizationId).eq('id', input.runId).single();
  if (error || !run?.resource_id || run.status !== 'pending') {
    throw new DomainError('Only a pending import with its source can resume staging.', 'integrations.stage_failed');
  }
  const parsed = await downloadImportFile(db, { organizationId: input.organizationId, resourceId: run.resource_id });
  if (!parsed || parsed.truncated) throw new DomainError('The complete source is unavailable. Upload it again.', 'integrations.file_missing');
  const resource = await db.from('integration_resources').select('display_name,resource_type').eq('organization_id', input.organizationId).eq('id', run.resource_id).single();
  if (resource.error) throw new DomainError('The import source could not be read.', 'integrations.resource_get_failed');
  const snapshot = run.mapping_snapshot as { mapping?: MappingField[] };
  if (!Array.isArray(snapshot.mapping)) throw new DomainError('The saved mapping is unavailable.', 'integrations.mapping_missing');
  return stageRows(db, {
    ...input, mapping: snapshot.mapping,
    fieldDefinitions: await listFieldDefinitions(db, { organizationId: input.organizationId, entityType: 'customer' }),
    sourceRows: sourceRowsForImport(parsed.rows, resource.data.resource_type === 'file_upload' ? resource.data.display_name : run.resource_id),
  });
}

export type ImportRunStatus = 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed';

export type ImportRun = {
  id: string;
  resourceId: string | null;
  mappingId: string | null;
  connectorKey: string;
  status: ImportRunStatus;
  rowsSeen: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;
  startedAt: string;
  finishedAt: string | null;
};

export type StagingRowStatus = 'ready' | 'duplicate' | 'invalid' | 'ignored' | 'applied' | 'failed';

export type StagingRow = {
  id: string;
  sourceRecordKey: string;
  raw: Record<string, string>;
  normalized: Record<string, unknown>;
  validationErrors: string[];
  proposedAction: 'create' | 'update' | 'skip';
  matchedCustomerId: string | null;
  status: StagingRowStatus;
};

function toRun(row: {
  id: string;
  resource_id: string | null;
  mapping_id: string | null;
  connector_key: string;
  status: string;
  rows_seen: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  rows_failed: number;
  started_at: string;
  finished_at: string | null;
}): ImportRun {
  return {
    id: row.id,
    resourceId: row.resource_id,
    mappingId: row.mapping_id,
    connectorKey: row.connector_key,
    status: row.status as ImportRunStatus,
    rowsSeen: row.rows_seen,
    rowsCreated: row.rows_created,
    rowsUpdated: row.rows_updated,
    rowsSkipped: row.rows_skipped,
    rowsFailed: row.rows_failed,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const RUN_COLUMNS =
  'id, resource_id, mapping_id, connector_key, status, rows_seen, rows_created, rows_updated, rows_skipped, rows_failed, started_at, finished_at';

export async function listImportRuns(db: Db, input: { organizationId: string }): Promise<ImportRun[]> {
  const { data, error } = await db
    .from('import_runs')
    .select(RUN_COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('started_at', { ascending: false });

  if (error) {
    throw fromDatabaseError(error, 'integrations.runs_list_failed');
  }
  return (data ?? []).map(toRun);
}

export async function getImportRun(
  db: Db,
  input: { organizationId: string; runId: string },
): Promise<ImportRun | null> {
  const { data, error } = await db
    .from('import_runs')
    .select(RUN_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.runId)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error, 'integrations.run_get_failed');
  }
  return data ? toRun(data) : null;
}

export async function listStagingRows(
  db: Db,
  input: { organizationId: string; runId: string; status?: StagingRowStatus },
): Promise<StagingRow[]> {
  let query = db
    .from('import_staging_rows')
    .select('id, source_record_key, raw, normalized, validation_errors, proposed_action, matched_customer_id, status')
    .eq('organization_id', input.organizationId)
    .eq('run_id', input.runId)
    .order('created_at', { ascending: true });

  if (input.status) {
    query = query.eq('status', input.status);
  }

  const data = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await query.order('id').range(offset, offset + 999);
    if (page.error) throw fromDatabaseError(page.error, 'integrations.staging_list_failed');
    data.push(...(page.data ?? []));
    if (!page.data || page.data.length < 1000) break;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sourceRecordKey: row.source_record_key,
    raw: (row.raw ?? {}) as Record<string, string>,
    normalized: (row.normalized ?? {}) as Record<string, unknown>,
    validationErrors: Array.isArray(row.validation_errors) ? (row.validation_errors as string[]) : [],
    proposedAction: row.proposed_action as StagingRow['proposedAction'],
    matchedCustomerId: row.matched_customer_id,
    status: row.status as StagingRowStatus,
  }));
}

/** Opens a run and freezes the mapping it will use — see `begin_import_run`. */
export async function beginImportRun(
  db: Db,
  input: { organizationId: string; mappingId: string },
): Promise<string> {
  await requireActor(db);
  await requireImportPipeline(db);

  const { data, error } = await db.rpc('begin_import_run', {
    p_organization_id: input.organizationId,
    p_mapping_id: input.mappingId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot run imports here.', 'integrations.forbidden');
    }
    throw fromDatabaseError(error, 'integrations.begin_failed');
  }

  return data;
}

/**
 * Parse a source's raw rows against a mapping, normalize and validate every one in this
 * process, then stage bounded batches. Matching against existing customers and
 * in-batch duplicate detection both happen server-side (`stage_import_rows`), under the same RLS
 * this caller's own session already carries.
 */
export async function stageRows(
  db: Db,
  input: {
    organizationId: string;
    runId: string;
    mapping: MappingField[];
    fieldDefinitions: FieldDefinition[];
    sourceRows: { key: string; raw: Record<string, string> }[];
  },
): Promise<number> {
  await requireActor(db);
  await requireImportPipeline(db);

  const rows = input.sourceRows.map(({ key, raw }, index) => {
    const { normalized, validationErrors } = normalizeImportRow(input.mapping, input.fieldDefinitions, raw);
    return {
      // The row's own position in this upload — `stage_import_rows` ranks in-batch duplicates
      // by this, since Postgres cannot derive an ordinal from a jsonb array alongside an
      // explicit column definition list (`WITH ORDINALITY` refuses the combination).
      seq: index,
      source_record_key: key,
      raw,
      normalized,
      validation_errors: validationErrors,
    };
  });

  let count = 0;
  for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
    const { data, error } = await db.rpc('stage_import_rows', {
      p_organization_id: input.organizationId,
      p_run_id: input.runId,
      p_rows: rows.slice(offset, offset + IMPORT_BATCH_SIZE),
    });
    if (error) {
      if (error.code === '42501') throw new DomainError('You cannot run imports here.', 'integrations.forbidden');
      throw new DomainError(`Stopped after ${offset} rows. Resume to continue.`, 'integrations.stage_failed');
    }
    count = data;
  }
  return count;
}

/** Apply one committed batch; another call resumes the same run. */
export async function applyImportRun(
  db: Db,
  input: { organizationId: string; runId: string },
): Promise<void> {
  await requireActor(db);
  await requireImportPipeline(db);

  const { error } = await db.rpc('apply_import_run', {
    p_organization_id: input.organizationId,
    p_run_id: input.runId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot run imports here.', 'integrations.forbidden');
    }
    if (error.code === '22023' && error.message.includes('already been applied')) {
      throw new DomainError('This import has already run.', 'integrations.already_applied');
    }
    throw fromDatabaseError(error, 'integrations.apply_failed');
  }
}
