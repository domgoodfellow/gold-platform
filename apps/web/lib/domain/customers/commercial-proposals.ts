import type { Json } from '@/lib/db/database.types';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

export type CommercialProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined';

export type CommercialProposalAddon = {
  addonPlanId: string;
  label: string;
  priceMinor: number;
};

/**
 * What a proposal is priced from. `platform_plan` is every proposal built before ADR-051's catalog
 * slice — a GildOps Platform Plan offer, still readable and still the only basis the technical
 * hand-off accepts. `catalog` is the seller's own Finance catalog, copied into `lines`.
 */
export type CommercialProposalBasis = 'platform_plan' | 'catalog';

/** One copied catalog line. The price is the one in force when the proposal was built. */
export type CommercialProposalLine = {
  position: number;
  priceBookItemId: string;
  name: string;
  unit: string;
  currency: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
};

export type CommercialProposal = {
  id: string;
  organizationId: string;
  customerId: string;
  basis: CommercialProposalBasis;
  /** Platform Plan proposals only; null on a catalog proposal. */
  planId: string | null;
  planLabel: string | null;
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
  /** The copied total of a catalog proposal's lines; null on a Platform Plan proposal. */
  catalogTotalMinor: number | null;
  lines: CommercialProposalLine[];
};

/**
 * What the proposal asks the customer to agree to. A catalog proposal's total was fixed when it
 * was built; a Platform Plan proposal's is its plan plus add-ons, minus any discount.
 */
export function commercialProposalTotalMinor(
  proposal: Pick<CommercialProposal, 'planPriceMinor' | 'addonPriceMinor' | 'discountMinor'> &
    Partial<Pick<CommercialProposal, 'basis' | 'catalogTotalMinor'>>,
): number {
  if (proposal.basis === 'catalog') return proposal.catalogTotalMinor ?? 0;
  return Math.max(0, proposal.planPriceMinor + proposal.addonPriceMinor - proposal.discountMinor);
}

const PROPOSAL_COLUMNS =
  'id, organization_id, customer_id, basis, catalog_total_minor, plan_id, plan_label, currency, billing_interval, plan_price_minor, addon_price_minor, discount_minor, discount_reason, notes, status, version, supersedes_id, created_at, created_by, accepted_by, accepted_at, accepted_configuration, proposed_configuration, declined_by, declined_at';

type ProposalRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  basis: string;
  catalog_total_minor: number | string | null;
  plan_id: string | null;
  plan_label: string | null;
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

function toProposal(row: ProposalRow, addons: CommercialProposalAddon[], lines: CommercialProposalLine[]): CommercialProposal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    basis: row.basis === 'catalog' ? 'catalog' : 'platform_plan',
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
    catalogTotalMinor: row.catalog_total_minor === null ? null : Number(row.catalog_total_minor),
    lines,
  };
}

async function listLinesFor(db: Db, input: { organizationId: string; proposalId: string }): Promise<CommercialProposalLine[]> {
  const { data, error } = await db
    .from('customer_commercial_proposal_lines')
    .select('position, price_book_item_id, name, unit, currency, quantity, unit_amount_minor, amount_minor')
    .eq('organization_id', input.organizationId)
    .eq('proposal_id', input.proposalId)
    .order('position');
  if (error) throw new DomainError(error.message, 'commercial_proposals.lines_failed');
  return (data ?? []).map((row) => ({
    position: row.position,
    priceBookItemId: row.price_book_item_id,
    name: row.name,
    unit: row.unit,
    currency: row.currency,
    quantity: row.quantity,
    unitAmountMinor: Number(row.unit_amount_minor),
    amountMinor: Number(row.amount_minor),
  }));
}

async function hydrate(db: Db, row: ProposalRow): Promise<CommercialProposal> {
  const scope = { organizationId: row.organization_id, proposalId: row.id };
  const [addons, lines] = await Promise.all([listAddonsFor(db, scope), listLinesFor(db, scope)]);
  return toProposal(row, addons, lines);
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
  return Promise.all(rows.map((row) => hydrate(db, row)));
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
  return hydrate(db, data as ProposalRow);
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
  return Promise.all(rows.map((row) => hydrate(db, row)));
}

export type CatalogProposalLineRequest = { priceBookItemId: string; quantity: number };

const BUILD_REFUSALS: Record<string, [string, string]> = {
  '42501': ['You cannot build proposals for this business.', 'commercial_proposals.forbidden'],
  '22023': ['Each line needs a catalog item and a whole quantity from 1 to 1,000,000.', 'commercial_proposals.lines_invalid'],
  GD011: ['That customer is not in this organization.', 'commercial_proposals.customer_not_found'],
  GD012: ['A line names a catalog item this business does not have.', 'commercial_proposals.item_not_found'],
  GD013: ['Every item must be priced in this business’s trading currency.', 'commercial_proposals.currency_mismatch'],
};

/**
 * Build a new draft version from this business's own catalog. The caller names items, whole
 * quantities and notes; `build_catalog_proposal` copies each item's name, unit and price now,
 * totals the copies and writes the whole version in one transaction — so a later catalog change
 * never reprices a proposal the customer already holds, and nothing here can name a price.
 *
 * Always a new row: correcting terms is a fresh version superseding the latest, as before.
 */
export async function buildCatalogProposal(
  db: Db,
  input: { organizationId: string; customerId: string; lines: CatalogProposalLineRequest[]; notes?: string },
): Promise<CommercialProposal> {
  const { data, error } = await db.rpc('build_catalog_proposal', {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_lines: input.lines.map((line) => ({ price_book_item_id: line.priceBookItemId, quantity: line.quantity })),
    p_notes: input.notes ?? '',
  });
  if (error) {
    const refusal = BUILD_REFUSALS[error.code ?? ''];
    if (refusal) throw new DomainError(refusal[0], refusal[1]);
    throw new DomainError(error.message, 'commercial_proposals.create_failed');
  }
  const proposal = await getCommercialProposal(db, { organizationId: input.organizationId, proposalId: data as string });
  if (!proposal) throw new DomainError('The proposal was built but could not be read back.', 'commercial_proposals.create_failed');
  return proposal;
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
