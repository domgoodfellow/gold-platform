import type { Db } from '@/lib/db/types';
import { draftingProvider, type ConfigurationGap } from '@/lib/adapters/drafting';
import { DomainError } from '@/lib/domain/errors';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { configureBusiness, type BusinessShape } from './configure';

/**
 * Proposals: a configuration drafted from a business's own description, for a person to review.
 *
 * **The domain layer owns the flow and the adapter owns the drafting**, which is the split I15
 * asks for and D32 records. Nothing in this file names a provider or knows one exists; it asks
 * the capability for a proposal and writes down what came back, alongside who asked and what
 * they asked with.
 *
 * **Nothing here configures anything.** Applying a proposal is `configureBusiness`, called by a
 * person from a screen, and it lands in the next slice. What this file establishes is the row
 * that sits between the drafting and the applying — which is the whole of D32's second decision:
 * a proposal is a record somebody approved, not a configuration that arrived.
 *
 * **The organization exists before any of this runs**, and that is not incidental. A proposal is
 * tenant-owned like everything else (I2), which it could not be if it were drafted for a
 * business that did not exist yet — and a drafting flow that created one would be the second
 * creation path D29 forbids. Founding reopened in `20260901000001`; a business signs itself up
 * empty, and this is what fills it.
 */

/**
 * Re-exported so no screen imports the adapter.
 *
 * A gap is a question about a proposal, which makes it a domain-shaped thing that happens to be
 * produced by a capability. A component reaching `@/lib/adapters/drafting` for the type would be
 * one import away from reaching it for the provider.
 */
export type { ConfigurationGap };

export type ConfigurationProposalOutcome = 'draft' | 'applied' | 'failed' | 'discarded';

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

const OUTCOMES: ConfigurationProposalOutcome[] = ['draft', 'applied', 'failed', 'discarded'];

function isOutcome(value: string): value is ConfigurationProposalOutcome {
  return (OUTCOMES as string[]).includes(value);
}

/**
 * A row, in this layer's own words.
 *
 * `shape` and `gaps` are `jsonb` and arrive as `unknown`. They are cast rather than re-checked:
 * the adapter narrowed the answer before it was ever written, and re-validating on the way out
 * would be a second copy of that check in the place least able to do anything useful with a
 * failure. What guards the write is where the write happens.
 */
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
    shape: row.shape as BusinessShape,
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

/**
 * Every proposal this business has, newest first.
 *
 * Including the discarded and the failed ones, deliberately: the table has no delete grant
 * because a proposal that was turned down is a decision somebody made, and the next person to
 * wonder why the setup looks the way it does is owed the ones that did not happen.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS decided which rows
 * exist before this ran.
 */
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

/**
 * The one a person is currently looking at, or null.
 *
 * **The newest draft, rather than the newest row.** A business that applied a proposal last week
 * and has not asked for another is not currently reviewing anything, and a screen that showed
 * them the applied one with an Apply button would be offering to do it all again.
 */
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

/**
 * Whether this deployment can draft at all.
 *
 * Exists so a screen can say so rather than rendering a form that cannot work — D31's rule, and
 * the specific failure it was written from. A caller that skipped this would show a business a
 * box, take their description, and fail after they had written three paragraphs.
 */
export async function canDraftConfiguration(): Promise<boolean> {
  return (await draftingProvider()) !== null;
}

/**
 * Ask for a proposal, and write down what came back.
 *
 * **The description is theirs and is stored as written.** Nothing trims it into a summary or
 * rewrites it into platform vocabulary on the way in: the row has to be able to answer "did it
 * understand me", and a paraphrase cannot.
 *
 * **`previous` makes this a refinement rather than a restart.** Answering a question the last
 * proposal asked produces a new row carrying the old shape forward, so everything already agreed
 * to survives. Each turn is its own row for the reason the table has no delete grant: what was
 * proposed, and what was proposed instead, are both part of how the business ended up configured.
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
    // Application state in the platform's own voice, which is the one thing D31 permits a
    // platform sentence to describe. It says what is missing and does not suggest the business
    // did anything wrong.
    throw new DomainError(
      'This installation cannot draft a setup. Everything here can still be configured by hand.',
      'proposals.no_provider',
    );
  }

  // Read through the domain layer rather than the table, so RLS and the caller's membership
  // decide this the same way they decide everything else. A stranger gets null here, not a name.
  const organization = await getOrganization(db, input.organizationId);
  if (!organization) {
    throw new DomainError('That business is not yours to configure.', 'proposals.forbidden');
  }

  let drafted: Awaited<ReturnType<typeof provider.draft>>;
  try {
    drafted = await provider.draft({
      description,
      business: {
        name: organization.name,
        currency: organization.currency,
        timeZone: organization.timezone,
      },
      current: input.previous?.shape ?? null,
    });
  } catch {
    // The adapter throws when the provider is unreachable or answered with something that is not
    // a configuration, and returns null when it declined. Two sentences, because they are two
    // situations and only one of them is worth trying again.
    //
    // The provider's own words are deliberately not shown. A `DomainError` is a sentence a
    // caller may put in front of a person, and a vendor's HTTP failure is not one — it is also
    // the one way a provider's vocabulary could reach a screen from behind an adapter.
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
      shape: drafted.shape as never,
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
 * Replace the shape on a draft with what a person edited it into.
 *
 * **This is the half that keeps the review from being a rubber stamp** (D32). A person who can
 * only accept or reject is not reviewing a proposal, they are approving one — and the argument
 * D29 makes for the self-serve door is that a proposal *edited* by the person who runs the
 * business beats a form filled in by somebody guessing.
 *
 * Only a draft can be edited, and the policy is what enforces it rather than this function: an
 * applied or failed row matches no update policy, so what was applied cannot later be made to
 * say something else was.
 */
export async function reviseConfigurationProposal(
  db: Db,
  input: { proposalId: string; shape: BusinessShape },
): Promise<ConfigurationProposal> {
  await requireActor(db);

  const { data, error } = await db
    .from('configuration_proposals')
    .update({ shape: input.shape as never })
    .eq('id', input.proposalId)
    .select(COLUMNS)
    .single();

  if (error) {
    // No row came back. The update policy matches drafts only, so the ordinary cause is a
    // proposal that has since been applied, failed or discarded — and it is a race rather than a
    // mistake: two people looking at the same screen, one of whom pressed Apply.
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

/**
 * What this business actually has right now.
 *
 * **An observation, not a report from the sequence that just ran.** `configureBusiness` throws
 * on the first step that fails and has no way to hand back what it wrote before that — and
 * giving it one would mean threading progress through a function whose whole claim is that it is
 * a fixed sequence with no branch in it. So a failed apply reads the business back instead, which
 * is the same thing every screen does and is true regardless of which call raised.
 *
 * It counts rather than lists, because what the person needs from the row is *how far it got*.
 * What they need in order to fix it is the live configuration beside the proposal, which the
 * setup screen renders from these same readers.
 */
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
 * Apply one, under the acting person's own session.
 *
 * **This adds no capability and must never add one** (D32). Every write it makes goes through
 * `configureBusiness`, whose every step already runs against a policy calling
 * `app.has_capability` — so somebody who may not create a role cannot apply a proposal
 * containing one, and the refusal comes from `roles_insert`. A check here would be a second copy
 * of an authorization rule that already exists, in the place least able to keep it in step.
 *
 * **A failure is recorded and not rolled back**, which is the decision D32 records at length.
 * `configureBusiness` is not atomic and stays so: making it atomic means one privileged function
 * taking the shape as JSON, which puts the order of those steps in the database and creates a
 * second configuration path — the same mistake D29 forbids one level up. So the row carries the
 * database's or the domain layer's own words and a reading of how far it got, the person edits
 * the remainder, and applies again.
 *
 * **Re-applying is a new draft rather than an edit to this row**, because the update policy
 * matches drafts only. What was applied stays exactly as it was applied.
 */
export async function applyConfigurationProposal(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<ConfigurationProposal> {
  await requireActor(db);

  // **Read rather than take, and a test is why.** The first version accepted the proposal object
  // its caller was holding and checked *that* for `draft` — which is a snapshot, and a caller
  // holding a stale one walked straight past the guard and ran the whole sequence again against
  // a business that already had it. The route re-read before calling, so the shipped path was
  // fine; a rule that holds only because every caller remembers to do something is not a rule
  // the domain layer owns.
  const { data: row, error: readError } = await db
    .from('configuration_proposals')
    .select(COLUMNS)
    .eq('id', input.proposalId)
    .maybeSingle();

  if (readError) {
    throw new DomainError(readError.message, 'proposals.read_failed');
  }
  if (!row) {
    throw new DomainError('That proposal is not there.', 'proposals.not_found');
  }

  const proposal = toProposal(row);
  if (proposal.outcome !== 'draft') {
    throw new DomainError(
      'That proposal has already been applied or discarded.',
      'proposals.not_a_draft',
    );
  }

  let result: Record<string, unknown>;
  let detail: string | null = null;

  try {
    const configured = await configureBusiness(db, input.organizationId, proposal.shape);
    result = { ...configured };
  } catch (error) {
    // A `DomainError` is a sentence somebody may read, which is exactly what this row is for.
    // Anything else is an infrastructure failure and its message is not one, so it is recorded
    // as what it is rather than dressed up.
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
    .select(COLUMNS)
    .single();

  if (error) {
    // The configuration landed and the record of it did not, which is the one outcome worth
    // saying plainly rather than swallowing: the business is configured and this row still says
    // draft. Re-applying would try the whole sequence again against a business that already has
    // half of it, so the person is told rather than invited to press the button twice.
    throw new DomainError(
      'The setup ran, but this proposal could not be marked as applied. Check the business’s configuration before applying anything else.',
      'proposals.apply_unrecorded',
    );
  }

  return toProposal(data);
}

/**
 * Turn one down.
 *
 * An outcome rather than a delete — see the table. A business that asked and decided against it
 * has made a decision, and it stays on the record beside the ones it made.
 */
export async function discardConfigurationProposal(
  db: Db,
  input: { proposalId: string },
): Promise<void> {
  await requireActor(db);

  const { error } = await db
    .from('configuration_proposals')
    .update({ outcome: 'discarded' })
    .eq('id', input.proposalId);

  if (error) {
    throw new DomainError(error.message, 'proposals.discard_failed');
  }
}
