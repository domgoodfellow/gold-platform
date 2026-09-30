import type { Json } from '@/lib/db/database.types';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { getCommercialProposal } from '@/lib/domain/customers/commercial-proposals';
import { getCustomer } from '@/lib/domain/customers/customers';
import {
  discoverySnapshotCompleteness,
  getDiscoverySnapshot,
  unresolvedDiscoveryRequirements,
  type DiscoverySnapshotAnswers,
} from '@/lib/domain/customers/discovery-snapshots';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Slice 10, the terminal boundary: "Create this business in GildOps," from one accepted
 * commercial proposal. Owner membership and default modules are already `provisionOrganization`'s
 * own doing (D29) — this hands off the rest of what the plan asked for and stops. Agreement,
 * Entitlements, Initial configuration, Readiness and Launch are Conversation 2's, not built here.
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
  if (error) throw new DomainError(error.message, 'proposal_handoff.get_failed');
  return data ? toHandoff(data) : null;
}

/**
 * Create the prospect's own business from an accepted proposal, and record having done so.
 *
 * Two acts, not one transaction (D32's precedent: `applyConfigurationProposal` isn't atomic
 * either). `provisionOrganization` is its own privileged, self-contained write — staff-only,
 * checked live, same door every other founded business goes through — and it either succeeds
 * whole or fails whole before this function's own row is ever written. If recording the handoff
 * fails afterward, the business still exists; a caller can be told to retry recording it without
 * risking a second business for one acceptance (the table's own unique constraint refuses that
 * regardless).
 */
export async function handoffAcceptedProposal(
  db: Db,
  input: { organizationId: string; proposalId: string; timezone?: string },
): Promise<AcceptedProposalHandoff> {
  const actor = await requireActor(db);

  const existing = await getProposalHandoff(db, input);
  if (existing) {
    throw new DomainError('This proposal has already been handed off.', 'proposal_handoff.already_handed_off');
  }

  const proposal = await getCommercialProposal(db, input);
  if (!proposal) {
    throw new DomainError('No such proposal, or you may not act on it.', 'proposal_handoff.proposal_not_found');
  }
  if (proposal.status !== 'accepted') {
    throw new DomainError('Only an accepted proposal can be handed off.', 'proposal_handoff.not_accepted');
  }

  const customer = await getCustomer(db, { organizationId: input.organizationId, customerId: proposal.customerId });
  if (!customer) {
    throw new DomainError('No such customer.', 'proposal_handoff.customer_not_found');
  }
  if (!customer.email) {
    throw new DomainError(
      'This customer has no email on file — the owner needs an address to sign in with.',
      'proposal_handoff.owner_email_required',
    );
  }

  const snapshot = await getDiscoverySnapshot(db, { organizationId: input.organizationId, customerId: proposal.customerId });

  const createdOrganizationId = await provisionOrganization(db, {
    ownerEmail: customer.email,
    // The business's own name, never a word the platform chose (D6) — the same name it was
    // recorded under from the first intake.
    name: customer.name,
    displayName: 'Owner',
    currency: proposal.currency,
    timezone: input.timezone,
  });

  const commercialTerms: Json = {
    planId: proposal.planId,
    planLabel: proposal.planLabel,
    addons: proposal.addons.map((addon) => ({ addonPlanId: addon.addonPlanId, label: addon.label, priceMinor: addon.priceMinor })),
    currency: proposal.currency,
    billingInterval: proposal.billingInterval,
    planPriceMinor: proposal.planPriceMinor,
    addonPriceMinor: proposal.addonPriceMinor,
    discountMinor: proposal.discountMinor,
    discountReason: proposal.discountReason,
    version: proposal.version,
  };

  const { data, error } = await db
    .from('customer_proposal_handoffs')
    .insert({
      organization_id: input.organizationId,
      customer_id: proposal.customerId,
      proposal_id: proposal.id,
      created_organization_id: createdOrganizationId,
      discovery_snapshot: (snapshot?.answers ?? {}) as Json,
      accepted_configuration: proposal.acceptedConfiguration,
      commercial_terms: commercialTerms,
      created_by: actor.id,
    })
    .select('id, organization_id, customer_id, proposal_id, created_organization_id, discovery_snapshot, accepted_configuration, commercial_terms, created_at, created_by')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('This proposal has already been handed off.', 'proposal_handoff.already_handed_off');
    }
    throw new DomainError(
      `The business was created (${createdOrganizationId}) but recording the handoff failed: ${error.message}`,
      'proposal_handoff.record_failed',
    );
  }

  return toHandoff(data);
}
