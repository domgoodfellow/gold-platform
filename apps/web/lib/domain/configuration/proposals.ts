import type { Db } from '@/lib/db/types';
import { DraftingNotEntitledError, draftingProvider, type ConfigurationGap } from '@/lib/adapters/drafting';
import { DomainError } from '@/lib/domain/errors';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { configureBusiness, type BusinessShape } from './configure';
import { readBusinessShape } from './shape';

/**
 * Proposals: a configuration drafted from a business's own description, for a person to review.
 * The domain layer owns the flow, the adapter owns the drafting (I15, D32) — this file never
 * names a provider. Applying is a separate act (`configureBusiness`, called from a screen): a
 * proposal is a record somebody approved, not a configuration that arrived. Runs only against
 * an organization that already exists — a drafting flow that created one would be the second
 * creation path D29 forbids.
 */

/** Re-exported so no screen imports the adapter directly for the type. */
export type { ConfigurationGap };

export type ConfigurationProposalOutcome = 'draft' | 'applying' | 'applied' | 'failed' | 'discarded';

export type ConfigurationProposal = {
  id: string;
  /** What the business wrote. Kept so a reviewer can tell whether they were understood. */
  description: string;
  shape: BusinessShape;
  /** What the drafting could not settle, as questions somebody can answer. */
  gaps: ConfigurationGap[];
  outcome: ConfigurationProposalOutcome;
  /** The database's or the domain layer's own words, when applying did not finish. */
  detail: string | null;
  /** What applying produced, snapshotted. Never joined to (I8). */
  result: unknown;
  /** Which provider drafted it. For a person reading the row; decides nothing. */
  draftedBy: string;
  createdAt: string;
  appliedAt: string | null;
};

const DESCRIPTION_MAX = 8000;

const OUTCOMES: ConfigurationProposalOutcome[] = ['draft', 'applying', 'applied', 'failed', 'discarded'];

function isOutcome(value: string): value is ConfigurationProposalOutcome {
  return (OUTCOMES as string[]).includes(value);
}

/** Stored documents cross the same structural boundary as adapter and human edits. */
function toProposal(row: {
  id: string;
  description: string;
  shape: unknown;
  gaps: unknown;
  outcome: string;
  detail: string | null;
  result: unknown;
  drafted_by: string;
  created_at: string;
  applied_at: string | null;
}): ConfigurationProposal {
  return {
    id: row.id,
    description: row.description,
    shape: readBusinessShape(row.shape),
    gaps: (row.gaps ?? []) as ConfigurationGap[],
    outcome: isOutcome(row.outcome) ? row.outcome : 'draft',
    detail: row.detail,
    result: row.result,
    draftedBy: row.drafted_by,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

const COLUMNS =
  'id, description, shape, gaps, outcome, detail, result, drafted_by, created_at, applied_at';

/** Includes the discarded and failed ones deliberately — the table has no delete grant, since a turned-down proposal is a decision someone made and worth keeping beside the ones that stuck. */
export async function listConfigurationProposals(
  db: Db,
  input: { organizationId: string },
): Promise<ConfigurationProposal[]> {
  const { data, error } = await db
    .from('configuration_proposals')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'proposals.list_failed');
  }

  return (data ?? []).map(toProposal);
}

/** The newest *draft*, not the newest row — a business that applied one last week isn't currently reviewing anything, and showing them the applied one with an Apply button would offer to do it all again. */
export async function currentConfigurationProposal(
  db: Db,
  input: { organizationId: string },
): Promise<ConfigurationProposal | null> {
  const { data, error } = await db
    .from('configuration_proposals')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('outcome', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new DomainError(error.message, 'proposals.read_failed');
  }

  const row = (data ?? [])[0];
  return row ? toProposal(row) : null;
}

/** Lets a screen say "can't draft" rather than rendering a form that fails after somebody's written three paragraphs (D31). */
export async function canDraftConfiguration(): Promise<boolean> {
  return (await draftingProvider()) !== null;
}

/**
 * Ask for a proposal, and write down what came back. The description is stored exactly as
 * written — a paraphrase couldn't answer "did it understand me". `previous` makes this a
 * refinement rather than a restart: answering a question the last proposal asked carries the
 * old shape forward. Each turn is its own row, for the same reason the table has no delete
 * grant.
 */
export async function proposeConfiguration(
  db: Db,
  input: {
    organizationId: string;
    description: string;
    /** The proposal being revised, if this turn answers one. */
    previous?: ConfigurationProposal | null;
  },
): Promise<ConfigurationProposal> {
  const actor = await requireActor(db);

  const description = input.description.trim();
  if (description.length === 0) {
    throw new DomainError(
      'Say something about the business before asking for a proposal.',
      'proposals.description_required',
    );
  }
  if (description.length > DESCRIPTION_MAX) {
    throw new DomainError(
      `That description is longer than ${DESCRIPTION_MAX} characters.`,
      'proposals.description_too_long',
    );
  }

  const provider = await draftingProvider();
  if (!provider) {
    throw new DomainError(
      'This installation cannot draft a setup. Everything here can still be configured by hand.',
      'proposals.no_provider',
    );
  }

  // Read through the domain layer rather than the table, so RLS and membership decide this the same way they decide everything else.
  const organization = await getOrganization(db, input.organizationId);
  if (!organization) {
    throw new DomainError('That business is not yours to configure.', 'proposals.forbidden');
  }

  const { data: session } = await db.auth.getSession();
  const token = session.session?.access_token;
  if (!token) {
    throw new DomainError('Sign in to continue.', 'auth.required');
  }

  let drafted: Awaited<ReturnType<typeof provider.draft>>;
  try {
    drafted = await provider.draft({
      description,
      organizationId: input.organizationId,
      token,
      business: {
        name: organization.name,
        currency: organization.currency,
        timeZone: organization.timezone,
      },
      current: input.previous?.shape ?? null,
    });
  } catch (failure) {
    // Not holding guided setup is a fact about the business, not an outage, and the sentence says so.
    if (failure instanceof DraftingNotEntitledError) {
      throw new DomainError(
        'This business does not have guided setup. Everything it would propose can still be configured by hand.',
        'proposals.not_entitled',
      );
    }
    // The adapter throws for unreachable/malformed, returns null for a decline — two different
    // situations, only one worth retrying. The provider's own words aren't shown: a vendor's
    // HTTP failure isn't a sentence fit for a screen, and showing it would leak their vocabulary
    // through the adapter.
    throw new DomainError(
      'The setup could not be drafted just now. Nothing has been changed.',
      'proposals.draft_failed',
    );
  }

  if (!drafted) {
    throw new DomainError(
      'That description could not be turned into a setup. Try describing the work the business does and how a job moves from start to finish.',
      'proposals.draft_declined',
    );
  }

  const { data, error } = await db
    .from('configuration_proposals')
    .insert({
      organization_id: input.organizationId,
      description,
      shape: readBusinessShape(drafted.shape) as never,
      gaps: drafted.gaps as never,
      drafted_by: provider.name,
      created_by: actor.id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot ask for a setup to be drafted here.',
        'proposals.forbidden',
      );
    }
    throw new DomainError(error.message, 'proposals.create_failed');
  }

  return toProposal(data);
}

/**
 * Replace the shape on a draft with what a person edited it into — the half that keeps review
 * from being a rubber stamp (D32). Only a draft can be edited, enforced by the update policy
 * rather than this function: an applied or failed row matches no update policy, so what was
 * applied can't later be made to say something else was.
 */
export async function reviseConfigurationProposal(
  db: Db,
  input: { organizationId: string; proposalId: string; shape: BusinessShape },
): Promise<ConfigurationProposal> {
  await requireActor(db);

  const { data, error } = await db
    .from('configuration_proposals')
    .update({ shape: readBusinessShape(input.shape) as never })
    .eq('id', input.proposalId)
    .eq('organization_id', input.organizationId)
    .eq('outcome', 'draft')
    .select(COLUMNS)
    .single();

  if (error) {
    // No row back — the update policy matches drafts only, so the ordinary cause is a proposal already applied, failed or discarded (a race, not a mistake).
    if (error.code === 'PGRST116') {
      throw new DomainError(
        'That proposal is no longer a draft — it has been applied or discarded.',
        'proposals.not_a_draft',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot change this setup here.', 'proposals.forbidden');
    }
    throw new DomainError(error.message, 'proposals.revise_failed');
  }

  return toProposal(data);
}

/** What this business actually has right now — an observation, not a report from the sequence that just ran. `configureBusiness` throws on the first failing step with no way to hand back partial progress, so a failed apply reads the business back instead, same as any screen would. */
async function observeConfiguration(
  db: Db,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const [types, prices, roles, hours] = await Promise.all([
    listWorkItemTypes(db, { organizationId }),
    listPriceBookItems(db, { organizationId }),
    listRoles(db, { organizationId }),
    listOperatingHours(db, { organizationId }),
  ]);

  return {
    observedAfterFailure: true,
    workItemTypes: types.map((type) => type.name),
    priceBookItems: prices.length,
    roles: roles.length,
    operatingHours: hours.length,
  };
}

/**
 * Apply one, under the acting person's own session. Adds no capability — every write goes
 * through `configureBusiness`, whose steps already run against `app.has_capability` policies, so
 * a check here would be a second copy of a rule that already exists. A failure is recorded, not
 * rolled back (D32): making the sequence atomic would need one privileged function taking the
 * shape as JSON, which is a second configuration path (the same mistake D29 forbids elsewhere).
 * Re-applying is a new draft, not an edit — the update policy matches drafts only.
 */
export async function applyConfigurationProposal(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<ConfigurationProposal> {
  await requireActor(db);

  // Read through the tenant boundary, then atomically claim exactly that draft below.
  const { data: row, error: readError } = await db
    .from('configuration_proposals')
    .select(COLUMNS)
    .eq('id', input.proposalId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (readError) {
    throw new DomainError(readError.message, 'proposals.read_failed');
  }
  if (!row) {
    throw new DomainError('That proposal is not there.', 'proposals.not_found');
  }

  if (row.outcome !== 'draft') {
    throw new DomainError(
      'That proposal has already been applied or discarded.',
      'proposals.not_a_draft',
    );
  }
  readBusinessShape(row.shape);

  const { data: claimed, error: claimError } = await db
    .from('configuration_proposals')
    .update({ outcome: 'applying' })
    .eq('id', input.proposalId)
    .eq('organization_id', input.organizationId)
    .eq('outcome', 'draft')
    .select(COLUMNS)
    .maybeSingle();
  if (claimError || !claimed) {
    throw new DomainError('That proposal cannot be applied. It may already be running or your permission has changed.', 'proposals.not_a_draft');
  }
  const proposal = toProposal(claimed);

  let result: Record<string, unknown>;
  let detail: string | null = null;

  try {
    const configured = await configureBusiness(db, input.organizationId, proposal.shape);
    result = { ...configured };
  } catch (error) {
    // A `DomainError` is a sentence somebody may read; anything else is an infrastructure failure recorded as what it is, not dressed up.
    detail =
      error instanceof DomainError
        ? error.message
        : 'The setup stopped part-way and the database did not say why.';
    result = await observeConfiguration(db, input.organizationId);
  }

  const { data, error } = await db
    .from('configuration_proposals')
    .update({
      outcome: detail === null ? 'applied' : 'failed',
      detail,
      result: result as never,
      applied_at: new Date().toISOString(),
    })
    .eq('id', input.proposalId)
    .eq('organization_id', input.organizationId)
    .eq('outcome', 'applying')
    .select(COLUMNS)
    .single();

  if (error) {
    // The configuration landed and the record of it didn't — worth saying plainly, since re-applying would try the whole sequence again against a business that already has half of it.
    throw new DomainError(
      'The setup ran, but this proposal could not be marked as applied. Check the business’s configuration before applying anything else.',
      'proposals.apply_unrecorded',
    );
  }

  return toProposal(data);
}

/** An outcome, not a delete — a decision to turn a proposal down stays on the record beside the ones that stuck. */
export async function discardConfigurationProposal(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<void> {
  await requireActor(db);

  const { data, error } = await db
    .from('configuration_proposals')
    .update({ outcome: 'discarded' })
    .eq('id', input.proposalId)
    .eq('organization_id', input.organizationId)
    .eq('outcome', 'draft')
    .select('id')
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'proposals.discard_failed');
  }
  if (!data) throw new DomainError('That proposal is not an editable draft here.', 'proposals.not_a_draft');
}
