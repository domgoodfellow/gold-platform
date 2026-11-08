import type { Json } from '@/lib/db/database.types';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import type { BusinessShape } from '@/lib/domain/configuration/configure';
import { listIndustryTemplates } from '@/lib/domain/configuration/proposals';
import { adjustShape } from '@/lib/domain/configuration/shape';
import {
  discoverySnapshotCompleteness,
  unresolvedDiscoveryRequirements,
  type DiscoverySnapshotAnswers,
} from '@/lib/domain/customers/discovery-snapshots';

/**
 * "Create this business in GildOps," from one accepted commercial proposal. Owner membership and
 * default modules are already `provisionOrganization`'s own doing; `hand_off_accepted_proposal`
 * additionally records the commercial agreement and enters the accepted Plan and Add-ons onto
 * `organization_plan_assignments`, in the same transaction — a handed-off business is entitled to
 * what it bought the moment it exists. When the proposal agreed a starting setup, the new business
 * also gets it as a draft its owner reviews (`agreedStartingSetup`). Initial configuration,
 * readiness and launch are not done here: nothing calls `configureBusiness` or `launchOrganization`. What Setup does with the handoff — seeding
 * a configuration draft from `discoverySnapshot` rather than asking again — is `describeDiscoverySnapshot`
 * (`discovery-snapshots.ts`) and the setup page, not this file.
 *
 * `hand_off_accepted_proposal` (C1 closeout) is one atomic, idempotent SQL door: provisioning and
 * recording the handoff either both happen or neither does, and a repeat call for a proposal
 * already handed off returns the business already created rather than erroring or duplicating it.
 * The handoff insert also establishes its Client/Tenant relationship in that transaction;
 * retries preserve that original relationship period even if it has subsequently ended.
 */
export type AcceptedProposalHandoff = {
  id: string;
  organizationId: string;
  customerId: string;
  proposalId: string;
  createdOrganizationId: string;
  discoverySnapshot: DiscoverySnapshotAnswers;
  confirmedRequirements: number;
  unresolvedRequirements: readonly { key: string; question: string }[];
  acceptedConfiguration: Json | null;
  commercialTerms: Json;
  createdAt: string;
  createdBy: string;
};

function toHandoff(row: {
  id: string;
  organization_id: string;
  customer_id: string;
  proposal_id: string;
  created_organization_id: string;
  discovery_snapshot: unknown;
  accepted_configuration: Json | null;
  commercial_terms: Json;
  created_at: string;
  created_by: string;
}): AcceptedProposalHandoff {
  const answers = (row.discovery_snapshot ?? {}) as DiscoverySnapshotAnswers;
  const completeness = discoverySnapshotCompleteness({ answers });
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    proposalId: row.proposal_id,
    createdOrganizationId: row.created_organization_id,
    discoverySnapshot: answers,
    confirmedRequirements: completeness.answered,
    unresolvedRequirements: unresolvedDiscoveryRequirements({ answers }),
    acceptedConfiguration: row.accepted_configuration,
    commercialTerms: row.commercial_terms,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

/** The handoff already recorded for one proposal, or null — never more than one (the table's own unique constraint). */
export async function getProposalHandoff(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<AcceptedProposalHandoff | null> {
  const { data, error } = await db
    .from('customer_proposal_handoffs')
    .select('id, organization_id, customer_id, proposal_id, created_organization_id, discovery_snapshot, accepted_configuration, commercial_terms, created_at, created_by')
    .eq('organization_id', input.organizationId)
    .eq('proposal_id', input.proposalId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'proposal_handoff.get_failed');
  return data ? toHandoff(data) : null;
}

/**
 * The handoff a business was itself founded from, read from inside that business — the other
 * side of `getProposalHandoff`, which reads from inside the *selling* organization. Null for
 * every organically founded organization, which is most of them; the row simply doesn't exist,
 * never a permission question. A member of neither organization sees neither row (RLS).
 */
export async function getFoundingHandoff(
  db: Db,
  input: { organizationId: string },
): Promise<AcceptedProposalHandoff | null> {
  const { data, error } = await db
    .from('customer_proposal_handoffs')
    .select('id, organization_id, customer_id, proposal_id, created_organization_id, discovery_snapshot, accepted_configuration, commercial_terms, created_at, created_by')
    .eq('created_organization_id', input.organizationId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'proposal_handoff.get_failed');
  return data ? toHandoff(data) : null;
}

/**
 * The starting setup an accepted proposal agreed, if any: `accepted_configuration.template`, a
 * published template key plus `adjustments` — top-level parts of the setup that replace the
 * template's (for example its opening hours). Checked here, before anything is created, so an
 * agreement that names a missing template or a malformed part is refused rather than handed to
 * the new owner as a draft they cannot open.
 */
export type AgreedStartingSetup = { key: string; adjustments?: Partial<BusinessShape> };

export function agreedStartingSetup(configuration: Json | null): AgreedStartingSetup | null {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return null;
  const template = (configuration as Record<string, Json>).template;
  if (!template || typeof template !== 'object' || Array.isArray(template)) return null;
  const key = (template as Record<string, Json>).key;
  if (typeof key !== 'string' || key.trim() === '') return null;
  const adjustments = (template as Record<string, Json>).adjustments;
  return { key: key.trim(), ...(adjustments && typeof adjustments === 'object' && !Array.isArray(adjustments) ? { adjustments: adjustments as Partial<BusinessShape> } : {}) };
}

async function checkAgreedStartingSetup(db: Db, input: { organizationId: string; proposalId: string }): Promise<void> {
  const { data, error } = await db
    .from('customer_commercial_proposals')
    .select('accepted_configuration')
    .eq('organization_id', input.organizationId)
    .eq('id', input.proposalId)
    .maybeSingle();
  if (error || !data) return; // The SQL door reports a missing or unreadable proposal in its own words.
  const agreed = agreedStartingSetup(data.accepted_configuration);
  if (!agreed) return;
  const template = (await listIndustryTemplates(db)).find((candidate) => candidate.key === agreed.key);
  if (!template) {
    throw new DomainError(`The agreed starting setup, ${agreed.key}, is not a published template.`, 'proposal_handoff.template_unknown');
  }
  try {
    adjustShape(template.shape, { replace: agreed.adjustments });
  } catch {
    throw new DomainError('The agreed changes to the starting setup are not valid, so the business was not created.', 'proposal_handoff.template_invalid');
  }
}

/**
 * Create the prospect's own business from an accepted proposal, and record having done so.
 *
 * One atomic call. Safe to call again for the same proposal — a prior success is returned
 * unchanged; a prior failure left nothing behind to retry around, because the whole thing rolled
 * back with it. Never creates a second business for one acceptance.
 */
export async function handoffAcceptedProposal(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<AcceptedProposalHandoff> {
  await checkAgreedStartingSetup(db, input);
  const { error } = await db.rpc('hand_off_accepted_proposal', { p_proposal_id: input.proposalId });

  if (error) {
    // The SQL door raises every refusal as 42501 (create_booking's own precedent), so the
    // message — not the SQLSTATE — is what tells a staff caller which one happened. Unlike a
    // stranger holding a token, there is no adversarial reason to blur these for a signed-in
    // caller who already cleared organization membership to get here.
    if (error.code === '42501') {
      if (error.message.includes('only platform staff')) {
        throw fromDatabaseError(error, 'proposal_handoff.not_staff');
      }
      if (error.message.includes('only an accepted proposal')) {
        throw fromDatabaseError(error, 'proposal_handoff.not_accepted');
      }
      throw fromDatabaseError(error, 'proposal_handoff.forbidden');
    }
    if (error.code === '23514') {
      throw fromDatabaseError(error, 'proposal_handoff.owner_email_required');
    }
    throw fromDatabaseError(error, 'proposal_handoff.failed');
  }

  const handoff = await getProposalHandoff(db, input);
  if (!handoff) {
    // Unreachable in practice — the RPC above either raised or committed the row it just wrote —
    // but a null here would otherwise look like success to a caller expecting a value back.
    throw new DomainError('The handoff could not be read back after creating it.', 'proposal_handoff.read_back_failed');
  }
  return handoff;
}
