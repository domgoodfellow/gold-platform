import { CONTACT_LIFECYCLES } from '@/lib/domain/customers/classification';
import { DomainError } from '@/lib/domain/errors';
import { CONCEPTS, isSensitiveColumn, type Concept, type ConceptMapping, type SourceDiscovery } from './discovery';
import { INTERPRETATION_IDS, interpretationConflicts, type Interpretation, type InterpretationDecision, type InterpretationId } from './interpretations';

/**
 * A translation plan is everything a translated import needs to be rebuilt from its source: which
 * column supplies each concept, which interpretations were approved, and the defaults for new
 * contacts. It is saved as the run's mapping snapshot, so a later edit never rewrites what an
 * earlier run did, and staging can resume from it.
 */
export type TranslationPlan = {
  version: 1;
  mapping: ConceptMapping;
  decisions: Record<InterpretationId, InterpretationDecision>;
  /** Lifecycle for contacts this import creates; existing contacts keep theirs. */
  defaultLifecycle: string | null;
  /** `reference`: a historical do-not-call value is kept on the business as its own field. `omit`: it is not written, and the row is still held. It is never consent either way. */
  suppression: 'reference' | 'omit';
  /** Unrecognized source columns to keep as the business's own fields: source column → custom field key. */
  extraFields: Record<string, string>;
};

/** The default plan: every suggested column, every proposed interpretation approved, nothing extra. */
export function defaultPlan(discovery: SourceDiscovery, proposals: Interpretation[]): TranslationPlan {
  const decisions = Object.fromEntries(INTERPRETATION_IDS.map((id) => [id, 'rejected'])) as Record<InterpretationId, InterpretationDecision>;
  for (const proposal of proposals) decisions[proposal.id] = 'approved';
  return { version: 1, mapping: { ...discovery.mapping }, decisions, defaultLifecycle: null, suppression: 'reference', extraFields: {} };
}

const KEY = /^[a-z][a-z0-9_]{0,62}$/;

/** Refuses a plan that names columns the source lacks, a sensitive column, or an unknown concept, decision or lifecycle. */
export function validatePlan(plan: TranslationPlan, columns: readonly string[]): TranslationPlan {
  const known = new Set(columns);
  const mapping: ConceptMapping = {};
  const used = new Set<string>();
  for (const [concept, column] of Object.entries(plan.mapping ?? {}) as [string, string | undefined][]) {
    if (!column) continue;
    if (!(CONCEPTS as readonly string[]).includes(concept)) throw new DomainError(`“${concept}” is not something an import can read.`, 'integrations.plan_invalid');
    if (!known.has(column)) throw new DomainError(`The source has no column named “${column}”.`, 'integrations.plan_invalid');
    if (isSensitiveColumn(column)) throw new DomainError(`“${column}” may hold a credential and cannot be read into contacts.`, 'integrations.plan_invalid');
    if (used.has(column)) throw new DomainError(`“${column}” can supply one value only.`, 'integrations.plan_invalid');
    used.add(column);
    mapping[concept as Concept] = column;
  }
  if (!mapping.business_name && !mapping.person_name) throw new DomainError('Choose which column holds the business name or the person name.', 'integrations.plan_invalid');
  const decisions = {} as Record<InterpretationId, InterpretationDecision>;
  for (const id of INTERPRETATION_IDS) {
    const decision = plan.decisions?.[id] ?? 'rejected';
    if (decision !== 'approved' && decision !== 'rejected') throw new DomainError('Each interpretation is approved or rejected.', 'integrations.plan_invalid');
    decisions[id] = decision;
  }
  const conflict = interpretationConflicts(decisions, mapping);
  if (conflict) throw new DomainError(conflict, 'integrations.plan_invalid');
  const defaultLifecycle = plan.defaultLifecycle || null;
  if (defaultLifecycle && !(CONTACT_LIFECYCLES as readonly string[]).includes(defaultLifecycle)) throw new DomainError('Choose a lifecycle this business uses.', 'integrations.plan_invalid');
  if (plan.suppression !== 'reference' && plan.suppression !== 'omit') throw new DomainError('Choose how a historical do-not-call value is kept.', 'integrations.plan_invalid');
  const extraFields: Record<string, string> = {};
  for (const [column, key] of Object.entries(plan.extraFields ?? {})) {
    if (!key) continue;
    if (!known.has(column)) throw new DomainError(`The source has no column named “${column}”.`, 'integrations.plan_invalid');
    if (isSensitiveColumn(column)) throw new DomainError(`“${column}” may hold a credential and cannot be kept.`, 'integrations.plan_invalid');
    if (!KEY.test(key)) throw new DomainError(`“${key}” is not a field key.`, 'integrations.plan_invalid');
    if (used.has(column)) throw new DomainError(`“${column}” is already read as a known value.`, 'integrations.plan_invalid');
    extraFields[column] = key;
  }
  return { version: 1, mapping, decisions, defaultLifecycle, suppression: plan.suppression, extraFields };
}

/** Whether a plan reads a concept from a column lifted out of nested JSON, which the `extract_nested` interpretation governs. */
export function readsNested(plan: TranslationPlan, concept: Concept): boolean {
  const column = plan.mapping[concept];
  return Boolean(column && column.startsWith('meta.'));
}
