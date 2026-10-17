import type { Json } from '@/lib/db/database.types';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { currentPlanPrice, getPlanById, listPlanAddonIds, listPlanPrices } from '@/lib/domain/catalogue/plans';
import { recommendConfiguration } from '@/lib/domain/customers/configuration-recommendation';
import { getDiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type CommercialProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined';

export type CommercialProposalAddon = {
  addonPlanId: string;
  label: string;
  priceMinor: number;
};

export type CommercialProposal = {
  id: string;
  organizationId: string;
  customerId: string;
  planId: string;
  planLabel: string;
  currency: string;
  billingInterval: 'month' | 'year' | 'one_time';
  planPriceMinor: number;
  addonPriceMinor: number;
  discountMinor: number;
  discountReason: string | null;
  notes: string;
  status: CommercialProposalStatus;
  version: number;
  supersedesId: string | null;
  createdAt: string;
  createdBy: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptedConfiguration: Json | null;
  proposedConfiguration: Json | null;
  declinedBy: string | null;
  declinedAt: string | null;
  addons: CommercialProposalAddon[];
};

/** What GildOps actually charges for this: plan plus add-ons, minus any discount. Derived, never stored. */
export function commercialProposalTotalMinor(proposal: Pick<CommercialProposal, 'planPriceMinor' | 'addonPriceMinor' | 'discountMinor'>): number {
  return Math.max(0, proposal.planPriceMinor + proposal.addonPriceMinor - proposal.discountMinor);
}

const PROPOSAL_COLUMNS =
  'id, organization_id, customer_id, plan_id, plan_label, currency, billing_interval, plan_price_minor, addon_price_minor, discount_minor, discount_reason, notes, status, version, supersedes_id, created_at, created_by, accepted_by, accepted_at, accepted_configuration, proposed_configuration, declined_by, declined_at';

type ProposalRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  plan_id: string;
  plan_label: string;
  currency: string;
  billing_interval: string;
  plan_price_minor: number | string;
  addon_price_minor: number | string;
  discount_minor: number | string;
  discount_reason: string | null;
  notes: string;
  status: string;
  version: number;
  supersedes_id: string | null;
  created_at: string;
  created_by: string;
  accepted_by: string | null;
  accepted_at: string | null;
  accepted_configuration: Json | null;
  proposed_configuration: Json | null;
  declined_by: string | null;
  declined_at: string | null;
};

function toProposal(row: ProposalRow, addons: CommercialProposalAddon[]): CommercialProposal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    planId: row.plan_id,
    planLabel: row.plan_label,
    currency: row.currency,
    billingInterval: row.billing_interval as CommercialProposal['billingInterval'],
    planPriceMinor: Number(row.plan_price_minor),
    addonPriceMinor: Number(row.addon_price_minor),
    discountMinor: Number(row.discount_minor),
    discountReason: row.discount_reason,
    notes: row.notes,
    status: row.status as CommercialProposalStatus,
    version: row.version,
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    acceptedBy: row.accepted_by,
    acceptedAt: row.accepted_at,
    acceptedConfiguration: row.accepted_configuration,
    proposedConfiguration: row.proposed_configuration,
    declinedBy: row.declined_by,
    declinedAt: row.declined_at,
    addons,
  };
}

async function listAddonsFor(db: Db, input: { organizationId: string; proposalId: string }): Promise<CommercialProposalAddon[]> {
  const { data, error } = await db
    .from('customer_commercial_proposal_addons')
    .select('addon_plan_id, label, price_minor')
    .eq('organization_id', input.organizationId)
    .eq('proposal_id', input.proposalId);
  if (error) throw new DomainError(error.message, 'commercial_proposals.addons_failed');
  return (data ?? []).map((row) => ({ addonPlanId: row.addon_plan_id, label: row.label, priceMinor: Number(row.price_minor) }));
}

/** Every commercial proposal built for one customer, newest version first — the revision history in full, nothing hidden once superseded. */
export async function listCommercialProposals(
  db: Db,
  input: { organizationId: string; customerId: string },
): Promise<CommercialProposal[]> {
  const { data, error } = await db
    .from('customer_commercial_proposals')
    .select(PROPOSAL_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .order('version', { ascending: false });
  if (error) throw new DomainError(error.message, 'commercial_proposals.list_failed');

  const rows = (data ?? []) as ProposalRow[];
  return Promise.all(rows.map(async (row) => toProposal(row, await listAddonsFor(db, { organizationId: input.organizationId, proposalId: row.id }))));
}

/** One proposal by id, or null. Null covers both "no such proposal" and "not yours" indistinguishably, same as every other single-row reader in this domain. */
export async function getCommercialProposal(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<CommercialProposal | null> {
  const { data, error } = await db
    .from('customer_commercial_proposals')
    .select(PROPOSAL_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.proposalId)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'commercial_proposals.get_failed');
  if (!data) return null;

  const addons = await listAddonsFor(db, { organizationId: input.organizationId, proposalId: data.id });
  return toProposal(data as ProposalRow, addons);
}

/**
 * The proposals a recognized external customer may see — every non-draft version, newest first.
 * Reads exactly the rows `customer_commercial_proposals_select_external` already scopes to; this
 * function adds no filtering of its own; it is a plain, unscoped read, deliberately, because RLS
 * is where "this organization, this customer, never a draft" is decided.
 */
export async function listCommercialProposalsForExternalCustomer(db: Db): Promise<CommercialProposal[]> {
  const { data, error } = await db
    .from('customer_commercial_proposals')
    .select(PROPOSAL_COLUMNS)
    .order('version', { ascending: false });
  if (error) throw new DomainError(error.message, 'commercial_proposals.list_failed');

  const rows = (data ?? []) as ProposalRow[];
  return Promise.all(
    rows.map(async (row) => {
      const { data: addonRows, error: addonError } = await db
        .from('customer_commercial_proposal_addons')
        .select('addon_plan_id, label, price_minor')
        .eq('organization_id', row.organization_id)
        .eq('proposal_id', row.id);
      if (addonError) throw new DomainError(addonError.message, 'commercial_proposals.addons_failed');
      const addons = (addonRows ?? []).map((addon) => ({
        addonPlanId: addon.addon_plan_id,
        label: addon.label,
        priceMinor: Number(addon.price_minor),
      }));
      return toProposal(row, addons);
    }),
  );
}

export type BuildCommercialProposalInput = {
  organizationId: string;
  customerId: string;
  planId: string;
  addonPlanIds: string[];
  currency: string;
  billingInterval: 'month' | 'year' | 'one_time';
  discountMinor?: number;
  discountReason?: string;
  notes?: string;
};

/**
 * Build a new commercial proposal, snapshotting the plan's and each add-on's currently approved
 * price rather than joining to `platform_plan_prices` — a later price change must never
 * silently reprice a proposal a customer already has in hand.
 *
 * Always a new row. There is no update for a proposal's terms: correcting one is a fresh version,
 * `supersedesId` naming the one it replaces, so a customer's "what changed" is a real question
 * with a real answer rather than an edit history nobody kept.
 */
export async function buildCommercialProposal(db: Db, input: BuildCommercialProposalInput): Promise<CommercialProposal> {
  const actor = await requireActor(db);

  const plan = await getPlanById(db, input.planId);
  if (!plan || plan.kind !== 'plan') {
    throw new DomainError('That is not a sellable plan.', 'commercial_proposals.plan_invalid');
  }

  const planPrices = await listPlanPrices(db, input.planId);
  const planPrice = currentPlanPrice(planPrices, { currency: input.currency, billingInterval: input.billingInterval });
  if (!planPrice) {
    throw new DomainError(
      `${plan.label} has no approved price in ${input.currency} for that billing interval.`,
      'commercial_proposals.no_plan_price',
    );
  }

  const validAddonIds = new Set(await listPlanAddonIds(db, input.planId));
  const addonPlanIds = [...new Set(input.addonPlanIds)];
  const addons: CommercialProposalAddon[] = [];
  for (const addonPlanId of addonPlanIds) {
    if (!validAddonIds.has(addonPlanId)) {
      throw new DomainError('That add-on is not available on this plan.', 'commercial_proposals.addon_invalid');
    }
    const addonPlan = await getPlanById(db, addonPlanId);
    const addonPrices = await listPlanPrices(db, addonPlanId);
    const addonPrice = currentPlanPrice(addonPrices, { currency: input.currency, billingInterval: input.billingInterval });
    if (!addonPrice) {
      throw new DomainError(
        `${addonPlan?.label ?? 'That add-on'} has no approved price in ${input.currency} for that billing interval.`,
        'commercial_proposals.no_addon_price',
      );
    }
    addons.push({ addonPlanId, label: addonPlan?.label ?? '', priceMinor: addonPrice.amountMinor });
  }

  const discountMinor = input.discountMinor ?? 0;
  if (discountMinor > 0 && !input.discountReason?.trim()) {
    throw new DomainError('A discount needs a reason.', 'commercial_proposals.discount_reason_required');
  }

  const existing = await listCommercialProposals(db, { organizationId: input.organizationId, customerId: input.customerId });
  const previous = existing[0] ?? null;
  const version = (previous?.version ?? 0) + 1;

  // The authoritative recommendation, snapshotted now rather than left to be recomputed (and
  // possibly disagree with itself) later — the same reasoning `plan_price_minor` already holds
  // to, applied to configuration. Acceptance copies this back out; nothing downstream computes
  // its own second answer to "what was proposed".
  const snapshot = await getDiscoverySnapshot(db, { organizationId: input.organizationId, customerId: input.customerId });
  const proposedConfiguration = await recommendConfiguration(db, { answers: snapshot?.answers ?? {} });

  const { data, error } = await db
    .from('customer_commercial_proposals')
    .insert({
      organization_id: input.organizationId,
      customer_id: input.customerId,
      plan_id: input.planId,
      plan_label: plan.label,
      currency: input.currency,
      billing_interval: input.billingInterval,
      plan_price_minor: planPrice.amountMinor,
      addon_price_minor: addons.reduce((sum, addon) => sum + addon.priceMinor, 0),
      discount_minor: discountMinor,
      discount_reason: discountMinor > 0 ? input.discountReason!.trim() : null,
      notes: input.notes?.trim() ?? '',
      version,
      supersedes_id: previous?.id ?? null,
      proposed_configuration: proposedConfiguration as unknown as Json,
      created_by: actor.id,
    })
    .select(PROPOSAL_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23503') {
      throw new DomainError('That customer is not in this organization.', 'commercial_proposals.customer_not_found');
    }
    throw new DomainError(error.message, 'commercial_proposals.create_failed');
  }

  if (addons.length > 0) {
    const { error: addonError } = await db.from('customer_commercial_proposal_addons').insert(
      addons.map((addon) => ({
        organization_id: input.organizationId,
        proposal_id: data.id,
        addon_plan_id: addon.addonPlanId,
        label: addon.label,
        price_minor: addon.priceMinor,
      })),
    );
    if (addonError) throw new DomainError(addonError.message, 'commercial_proposals.addon_write_failed');
  }

  return toProposal(data as ProposalRow, addons);
}

/** Mark a draft as sent — the one status move a salesperson makes themselves; acceptance and decline belong to whoever the proposal was sent to. */
export async function markCommercialProposalSent(db: Db, input: { organizationId: string; proposalId: string }): Promise<void> {
  const { error } = await db
    .from('customer_commercial_proposals')
    .update({ status: 'sent' })
    .eq('organization_id', input.organizationId)
    .eq('id', input.proposalId)
    .eq('status', 'draft');
  if (error) throw new DomainError(error.message, 'commercial_proposals.send_failed');
}

/**
 * Accept a proposal as the customer it was sent to — the door only a recognized external
 * customer holding a valid, unrevoked proposal invite can open. `accepted_configuration` is
 * copied server-side from this proposal's own `proposed_configuration` snapshot (C1 closeout) —
 * never a value this function's own caller could shape, so accepting always records exactly what
 * was proposed, not whatever a request happened to carry.
 */
export async function acceptCommercialProposal(db: Db, input: { proposalId: string }): Promise<void> {
  const { error } = await db.rpc('accept_commercial_proposal', { p_proposal_id: input.proposalId });
  if (error) {
    if (error.code === '42501') {
      throw new DomainError('This proposal is not open for a response.', 'commercial_proposals.accept_forbidden');
    }
    throw new DomainError(error.message, 'commercial_proposals.accept_failed');
  }
}

/** Decline a proposal as the customer it was sent to. */
export async function declineCommercialProposal(db: Db, input: { proposalId: string }): Promise<void> {
  const { error } = await db.rpc('decline_commercial_proposal', { p_proposal_id: input.proposalId });
  if (error) {
    if (error.code === '42501') {
      throw new DomainError('This proposal is not open for a response.', 'commercial_proposals.decline_forbidden');
    }
    throw new DomainError(error.message, 'commercial_proposals.decline_failed');
  }
}
