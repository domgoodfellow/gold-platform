import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { downloadImportFile } from '@/lib/domain/integrations/resources';
import { discoverSource, expandRecord, type SourceDiscovery } from './discovery';
import { proposeInterpretations, type Interpretation } from './interpretations';
import { defaultPlan, validatePlan, type TranslationPlan } from './plan';
import { issueLabel, translateSource, type TranslatedRecord, type TranslationSummary } from './translate';

/**
 * The read-only inspection contract: what an agent, a page or a test may ask about an import
 * source without writing anything. Every answer is deterministic and comes from the rows and the
 * plan alone — no model is called, nothing leaves the process, and no contact is read or changed.
 * Applying stays with the existing run: `beginImportRun`, staging, a person's review and
 * `applyImportRun`, each under `integration.manage`.
 */

export type SourceInspection = {
  discovery: SourceDiscovery;
  interpretations: Interpretation[];
  /** The plan the interpretation page starts from: every suggestion, every interpretation approved. */
  plan: TranslationPlan;
  summary: TranslationSummary;
  /** The first translated rows, for a preview. */
  preview: TranslatedRecord[];
};

const PREVIEW_ROWS = 12;

/** Expands nested JSON in every row; the shape every other function here reads. */
export function expandRows(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.map((row) => expandRecord(row));
}

/** Inspects parsed rows: discovery, proposed interpretations, the default plan and what it would produce. */
export function inspectRows(parsed: { headers: string[]; rows: Record<string, string>[] }, plan?: TranslationPlan): SourceInspection {
  const rows = expandRows(parsed.rows);
  const discovery = discoverSource(rows, parsed.headers);
  const interpretations = proposeInterpretations(discovery, rows);
  const columns = discovery.columns.map((column) => column.name);
  const chosen = plan ? validatePlan(plan, columns) : defaultPlan(discovery, interpretations);
  const result = translateSource(rows, chosen);
  return { discovery, interpretations, plan: chosen, summary: result.summary, preview: result.records.slice(0, PREVIEW_ROWS) };
}

/** Quality issues as sentences with counts, for a summary a person or an agent can read. */
export function describeQuality(summary: TranslationSummary): string[] {
  return (Object.entries(summary.issues) as [keyof TranslationSummary['issues'], number][])
    .sort(([, a], [, b]) => b - a)
    .map(([code, count]) => `${count} row${count === 1 ? '' : 's'}: ${issueLabel({ code })}`);
}

/**
 * Inspects a saved import source of one business. The caller's own session reads the source, so
 * row-level security decides whether it is theirs; nothing is staged, decided or applied.
 */
export async function inspectImportSource(db: Db, input: { organizationId: string; resourceId: string; plan?: TranslationPlan }): Promise<SourceInspection> {
  await requireActor(db);
  const parsed = await downloadImportFile(db, { organizationId: input.organizationId, resourceId: input.resourceId });
  if (!parsed) throw new DomainError('That source has no rows to read.', 'integrations.file_missing');
  return inspectRows(parsed, input.plan);
}
