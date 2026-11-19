import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { downloadImportFile } from '@/lib/domain/integrations/resources';
import { findSavedTranslation } from '@/lib/domain/integrations/mappings';
import { discoverSource, expandRecord, type SourceDiscovery } from './discovery';
import { INTERPRETATION_IDS, proposeInterpretations, type Interpretation } from './interpretations';
import { defaultPlan, sourceSignature, validatePlan, type TranslationPlan } from './plan';
import { issueLabel, translateSource, type TranslatedRecord, type TranslationSummary } from './translate';

/**
 * The read-only inspection contract: what an agent, a page or a test may ask about an import
 * source without writing anything. Every answer is deterministic and comes from the rows and the
 * plan alone — no model is called, nothing leaves the process, and no contact is read or changed.
 * Applying stays with the existing run: `beginImportRun`, staging, a person's review and
 * `applyImportRun`, each under `integration.manage`.
 */

/**
 * Where the plan an inspection starts from came from. `rules`: the built-in reading of the
 * columns. `saved`: the plan a person approved for an earlier source with the same columns.
 * `chosen`: the plan the caller passed in. A model's proposal will be one more origin, labelled
 * as a suggestion and approved by a person like the others.
 */
export type PlanOrigin = 'rules' | 'saved' | 'chosen';

export type SourceInspection = {
  discovery: SourceDiscovery;
  interpretations: Interpretation[];
  /** The plan the interpretation page starts from, carrying the source's signature. */
  plan: TranslationPlan;
  origin: PlanOrigin;
  summary: TranslationSummary;
  /** The first translated rows, for a preview. */
  preview: TranslatedRecord[];
};

const PREVIEW_ROWS = 12;

/** Expands nested JSON in every row; the shape every other function here reads. */
export function expandRows(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.map((row) => expandRecord(row));
}

/**
 * Inspects parsed rows: discovery, proposed interpretations, the starting plan and what it would
 * produce. The plan is the caller's, else a saved plan that still fits these columns, else the
 * built-in reading.
 */
export function inspectRows(parsed: { headers: string[]; rows: Record<string, string>[] }, plan?: TranslationPlan, saved?: TranslationPlan | null): SourceInspection {
  const rows = expandRows(parsed.rows);
  const discovery = discoverSource(rows, parsed.headers);
  const interpretations = proposeInterpretations(discovery, rows);
  const columns = discovery.columns.map((column) => column.name);
  const signature = sourceSignature(parsed.headers);
  let origin: PlanOrigin = 'rules';
  let chosen: TranslationPlan;
  if (plan) { chosen = validatePlan(plan, columns); origin = 'chosen'; }
  else {
    chosen = defaultPlan(discovery, interpretations);
    if (saved) {
      // A saved decision carries only for an interpretation offered then and proposed now.
      const offered = new Set(saved.offered ?? INTERPRETATION_IDS);
      const decisions = { ...chosen.decisions };
      for (const proposal of interpretations) if (offered.has(proposal.id) && saved.decisions?.[proposal.id]) decisions[proposal.id] = saved.decisions[proposal.id];
      try { chosen = validatePlan({ ...saved, decisions }, columns); origin = 'saved'; }
      catch (error) { if (!(error instanceof DomainError)) throw error; }
    }
  }
  chosen = { ...chosen, signature, offered: interpretations.map((proposal) => proposal.id) };
  const result = translateSource(rows, chosen);
  return { discovery, interpretations, plan: chosen, origin, summary: result.summary, preview: result.records.slice(0, PREVIEW_ROWS) };
}

/** Quality issues as sentences with counts, for a summary a person or an agent can read. */
export function describeQuality(summary: TranslationSummary): string[] {
  return (Object.entries(summary.issues) as [keyof TranslationSummary['issues'], number][])
    .sort(([, a], [, b]) => b - a)
    .map(([code, count]) => `${count} row${count === 1 ? '' : 's'}: ${issueLabel({ code })}`);
}

/**
 * Inspects a saved import source of one business, starting from the plan the business saved for
 * the same columns when there is one. The caller's own session reads the source and the saved
 * plan, so row-level security decides whether they are theirs; nothing is staged, decided or applied.
 */
export async function inspectImportSource(db: Db, input: { organizationId: string; resourceId: string; plan?: TranslationPlan }): Promise<SourceInspection> {
  await requireActor(db);
  const parsed = await downloadImportFile(db, { organizationId: input.organizationId, resourceId: input.resourceId });
  if (!parsed) throw new DomainError('That source has no rows to read.', 'integrations.file_missing');
  const saved = input.plan ? null : await findSavedTranslation(db, { organizationId: input.organizationId, signature: sourceSignature(parsed.headers) });
  return inspectRows(parsed, input.plan, saved);
}
