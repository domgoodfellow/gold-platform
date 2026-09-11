import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { normalizeImportRow, type MappingField } from '@/lib/domain/integrations/mappings';

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
    throw new DomainError(error.message, 'integrations.runs_list_failed');
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
    throw new DomainError(error.message, 'integrations.run_get_failed');
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

  const { data, error } = await query;
  if (error) {
    throw new DomainError(error.message, 'integrations.staging_list_failed');
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

/** Opens a run and freezes the mapping it will use — see `begin_import_run` (I8). */
export async function beginImportRun(
  db: Db,
  input: { organizationId: string; mappingId: string },
): Promise<string> {
  await requireActor(db);

  const { data, error } = await db.rpc('begin_import_run', {
    p_organization_id: input.organizationId,
    p_mapping_id: input.mappingId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot run imports here.', 'integrations.forbidden');
    }
    throw new DomainError(error.message, 'integrations.begin_failed');
  }

  return data;
}

/**
 * Parse a source's raw rows against a mapping, normalize and validate every one in this
 * process, then stage the whole batch in a single call. Matching against existing customers and
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

  const { data, error } = await db.rpc('stage_import_rows', {
    p_organization_id: input.organizationId,
    p_run_id: input.runId,
    p_rows: rows,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot run imports here.', 'integrations.forbidden');
    }
    throw new DomainError(error.message, 'integrations.stage_failed');
  }

  return data;
}

/** The one writer. Refuses a second application of an already-applied run. */
export async function applyImportRun(
  db: Db,
  input: { organizationId: string; runId: string },
): Promise<void> {
  await requireActor(db);

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
    throw new DomainError(error.message, 'integrations.apply_failed');
  }
}
