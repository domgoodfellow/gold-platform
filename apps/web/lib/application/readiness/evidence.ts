import type { SetupArea, SetupImportance } from '@/lib/domain/tenancy/lifecycle';

/**
 * What a surface may truthfully say about whether something can be used. It is a vocabulary for
 * *presenting* readiness that a domain has already decided; it computes nothing and persists
 * nothing. Entitlement, activation, permission, configuration, provider verification and observed
 * operation are separate facts, and each state below names one of them rather than a blend:
 *
 * - `operational`: the domain has proven the intended operation can be performed now.
 * - `configured`: the configuration is present and valid; the domain has no verification to offer,
 *   so nothing more is claimed.
 * - `configuration-required`: something the operation needs is missing or invalid.
 * - `verification-required`: configured, but a check the domain does offer has not passed.
 * - `unavailable`: the state could not be read or an external dependency is failing.
 * - `restricted`: the viewer may not see or change it. This says nothing about the thing itself.
 * - `unknown`: not measured. Never shown as healthy or as zero.
 * - `not-applicable`: this business does not use it.
 */
export type ReadinessState =
  | 'operational'
  | 'configured'
  | 'configuration-required'
  | 'verification-required'
  | 'unavailable'
  | 'restricted'
  | 'unknown'
  | 'not-applicable';

export type ReadinessEvidence = {
  /** The concern, matching a configuration target key where there is one. */
  key: string;
  label: string;
  state: ReadinessState;
  /** One factual sentence, from the domain's own state. */
  explanation: string;
  /** Where it is resolved: a registered configuration destination, never a generic landing page. */
  destination?: { href: string; label: string };
  /** Whether this condition stops the intended operation, as opposed to being a suggestion. */
  blocksOperation: boolean;
  /** Setup's importance, when the evidence comes from Setup. Independent of `state`. */
  importance?: SetupImportance;
  /** When a check last ran, only if the domain records one. */
  verifiedAt?: string | null;
};

type Presentation = { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' };

export const READINESS_PRESENTATION: Record<ReadinessState, Presentation> = {
  operational: { label: 'Operational', tone: 'success' },
  configured: { label: 'Set up', tone: 'neutral' },
  'configuration-required': { label: 'Needs setting up', tone: 'warning' },
  'verification-required': { label: 'Needs verification', tone: 'warning' },
  unavailable: { label: 'Unavailable', tone: 'danger' },
  restricted: { label: 'Restricted', tone: 'neutral' },
  unknown: { label: 'Not measured', tone: 'neutral' },
  'not-applicable': { label: 'Not applicable', tone: 'neutral' },
};

/** A Setup area as evidence: a finished area is configured (Setup does not verify), an open one needs configuration and blocks only when it is required. */
export function evidenceFromSetupArea(area: SetupArea): ReadinessEvidence {
  if (area.state === 'complete') {
    return { key: area.key, label: area.label, state: 'configured', explanation: area.message, blocksOperation: false };
  }
  return {
    key: area.key,
    label: area.label,
    state: 'configuration-required',
    explanation: area.message,
    destination: area.area,
    blocksOperation: area.importance === 'required',
    importance: area.importance,
  };
}

/** Required gaps are the only Setup condition that blocks; this keeps the three classes apart for any consumer. */
export function classifySetupEvidence(evidence: readonly ReadinessEvidence[]) {
  return {
    blockers: evidence.filter((entry) => entry.blocksOperation),
    recommendations: evidence.filter((entry) => !entry.blocksOperation && entry.importance === 'recommended'),
    optional: evidence.filter((entry) => !entry.blocksOperation && entry.importance === 'optional'),
  };
}
