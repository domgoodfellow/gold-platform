import type { Db } from '@/lib/db/types';
import { DraftingNotEntitledError, draftingProvider, type ConfigurationGap } from '@/lib/adapters/drafting';
import { DomainError } from '@/lib/domain/errors';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { getOrganization, listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { MODULES, type ModuleKey } from '@/lib/navigation';
import { configureBusiness, readBusinessSetup, readBusinessSetupWithIndustry, type BusinessShape } from './configure';
import { readBusinessShape } from './shape';

/**
 * Proposals: a configuration drafted from a business's own description, for a person to review.
 * The domain layer owns the flow, the adapter owns the drafting — this file never
 * names a provider. Applying is a separate act (`configureBusiness`, called from a screen): a
 * proposal is a record somebody approved, not a configuration that arrived. Runs only against
 * an organization that already exists — a drafting flow that created one would be the second
 * creation path the one-creation-path rule forbids.
 */

/** Re-exported so no screen imports the adapter directly for the type. */
export type { ConfigurationGap };

export type ConfigurationProposalOutcome = 'draft' | 'applying' | 'applied' | 'failed' | 'discarded';

/**
 * Where a draft came from: the business's own description (`drafted`), a starting template the
 * owner chose (`template`), one GildOps staff chose when creating the business (`provisioned`), one
 * agreed in an accepted sales proposal (`agreed`), or another business of the same person's
 * (`copied`). Every one of them is reviewed and applied by the business the same way; the origin
 * only decides how the review screen introduces it.
 */
export type ConfigurationProposalOrigin = 'drafted' | 'template' | 'provisioned' | 'agreed' | 'copied';
const ORIGINS: ConfigurationProposalOrigin[] = ['drafted', 'template', 'provisioned', 'agreed', 'copied'];

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
  /** What applying produced, snapshotted. Never joined to. */
  result: unknown;
  /** Which provider drafted it. For a person reading the row; decides nothing. */
  draftedBy: string;
  createdAt: string;
  appliedAt: string | null;
  origin: ConfigurationProposalOrigin;
  /** The industry template this started from, if any. */
  templateKey: string | null;
  /** When the owner set it aside for later; it is still a draft. */
  deferredAt: string | null;
  /** For a copy, the business it was copied from. Its name is the description. */
  copiedFrom: string | null;
};

/** A platform-wide starting setup (`industry_templates`). Organizations read published ones only. */
export type IndustryTemplate = {
  key: string;
  name: string;
  category: string;
  description: string;
  shape: BusinessShape;
};

/** A template as platform staff manage it, published or not. */
export type ManagedIndustryTemplate = IndustryTemplate & { published: boolean };

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
  origin: string;
  template_key: string | null;
  deferred_at: string | null;
  copied_from: string | null;
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
    origin: ORIGINS.find((origin) => origin === row.origin) ?? 'drafted',
    templateKey: row.template_key,
    deferredAt: row.deferred_at,
    copiedFrom: row.copied_from,
  };
}

const COLUMNS =
  'id, description, shape, gaps, outcome, detail, result, drafted_by, created_at, applied_at, origin, template_key, deferred_at, copied_from';

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

/**
 * A starting setup GildOps prepared or agreed that its owner has not looked at yet: entering the
 * business opens it for review until it is applied, discarded or set aside with "Not now".
 */
export function awaitsFirstReview(proposal: ConfigurationProposal | null): boolean {
  return proposal !== null && (proposal.origin === 'provisioned' || proposal.origin === 'agreed') && proposal.deferredAt === null;
}

/** Lets a screen say "can't draft" rather than rendering a form that fails after somebody's written three paragraphs. */
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
 * from being a rubber stamp. Only a draft can be edited, enforced by the update policy
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

/**
 * A template's document, with what this business's plan does not include left out. A template
 * describes a kind of business, not a purchase, so a part of it outside the plan is dropped rather
 * than failing the whole apply (`configureBusiness` refuses anything unentitled). A grouped module
 * whose dependency was dropped goes with it. A business's own drafted proposal is never trimmed:
 * there the refusal is the honest answer.
 */
export async function fitShapeToPlan(
  db: Db,
  organizationId: string,
  shape: BusinessShape,
): Promise<{ shape: BusinessShape; leftOut: string[] }> {
  if (!shape.modules?.length && !shape.featureKeys?.length) return { shape, leftOut: [] };
  const states = await organizationResolvedFeatureStates(db, { organizationId });
  const usable = (match: (state: (typeof states)[number]) => boolean) =>
    states.some((state) => match(state) && state.entitled && state.implementationState === 'available');
  let modules = (shape.modules ?? []).filter((key) => usable((state) => state.moduleKey === key));
  // A module that needs one dropped above does nothing on its own.
  for (let changed = true; changed;) {
    const before = modules.length;
    modules = modules.filter((key) => {
      const entry = MODULES.find((candidate) => candidate.key === key);
      const needs = entry && 'requires' in entry ? (entry.requires as ModuleKey) : undefined;
      return !needs || modules.includes(needs);
    });
    changed = modules.length !== before;
  }
  const featureKeys = (shape.featureKeys ?? []).filter((key) => usable((state) => state.featureKey === key));
  const label = (key: string) => MODULES.find((entry) => entry.key === key)?.label ?? key;
  const leftOut = [
    ...(shape.modules ?? []).filter((key) => !modules.includes(key)).map(label),
    ...(shape.featureKeys ?? []).filter((key) => !featureKeys.includes(key)),
  ];
  return {
    shape: { ...shape, ...(shape.modules ? { modules } : {}), ...(shape.featureKeys ? { featureKeys } : {}) },
    leftOut,
  };
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
 * a check here would be a second copy of a rule that already exists.
 *
 * A failure is recorded, not rolled back, and a new draft of the same document is offered at
 * once (`retry_configuration_proposal`): applying is safe to repeat, so applying that draft
 * finishes what this one started, with nothing made twice. The failed row stays as the record of
 * what went wrong. `retryId` names the new draft.
 */
export async function applyConfigurationProposal(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<ConfigurationProposal & { retryId?: string }> {
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
    const fitted = proposal.origin === 'drafted'
      ? { shape: proposal.shape, leftOut: [] as string[] }
      : await fitShapeToPlan(db, input.organizationId, proposal.shape);
    const configured = await configureBusiness(db, input.organizationId, fitted.shape);
    if (proposal.templateKey) {
      const { error } = await db.rpc('record_starting_template', {
        p_organization_id: input.organizationId,
        p_template_key: proposal.templateKey,
      });
      if (error) throw new DomainError('The setup ran, but which template it started from could not be recorded.', 'proposals.template_unrecorded');
    }
    result = { ...configured, ...(fitted.leftOut.length ? { leftOut: fitted.leftOut } : {}) };
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
    // The configuration landed and the record of it didn't — worth saying plainly.
    throw new DomainError(
      'The setup ran, but this proposal could not be marked as applied. Check the business’s configuration before applying anything else.',
      'proposals.apply_unrecorded',
    );
  }

  const applied = toProposal(data);
  if (applied.outcome !== 'failed') return applied;
  const { data: retryId, error: retryError } = await db.rpc('retry_configuration_proposal', { p_proposal_id: applied.id });
  return retryError ? applied : { ...applied, retryId: retryId as string };
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

/** Set a draft aside for later. It stays a draft, reachable from Setup, until applied or discarded. */
export async function deferConfigurationProposal(
  db: Db,
  input: { organizationId: string; proposalId: string },
): Promise<void> {
  await requireActor(db);
  const { data, error } = await db
    .from('configuration_proposals')
    .update({ deferred_at: new Date().toISOString() })
    .eq('id', input.proposalId)
    .eq('organization_id', input.organizationId)
    .eq('outcome', 'draft')
    .select('id')
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'proposals.defer_failed');
  if (!data) throw new DomainError('That proposal is not an editable draft here.', 'proposals.not_a_draft');
}

/** The published starting templates, in catalogue order. */
export async function listIndustryTemplates(db: Db): Promise<IndustryTemplate[]> {
  const { data, error } = await db
    .from('industry_templates')
    .select('key, name, category, description, shape')
    .eq('published', true)
    .order('position', { ascending: true });
  if (error) throw new DomainError(error.message, 'templates.list_failed');
  return (data ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    category: row.category,
    description: row.description,
    shape: readBusinessShape(row.shape),
  }));
}

/**
 * The template that matches what a business said it does, if one plainly does: the same name or
 * category, or one inside the other. The industry is free text, so this only ever pre-selects.
 */
export function suggestedTemplateKey(templates: readonly IndustryTemplate[], industry: string | null): string | null {
  const said = (industry ?? '').trim().toLocaleLowerCase();
  if (!said) return null;
  const match = templates.find((template) => [template.name, template.category].some((word) => {
    const known = word.toLocaleLowerCase();
    return known === said || known.includes(said) || said.includes(known);
  }));
  return match?.key ?? null;
}

/**
 * Open a starting template as a draft for this business to review. Nothing is applied: the owner
 * sees the whole document, can change any of it, and applies it from the review screen. What the
 * plan does not include is left out now, so the draft shows what will actually be set up.
 */
export async function draftFromTemplate(
  db: Db,
  input: { organizationId: string; templateKey: string },
): Promise<ConfigurationProposal> {
  const actor = await requireActor(db);
  const waiting = await currentConfigurationProposal(db, { organizationId: input.organizationId });
  if (waiting) {
    throw new DomainError('A setup is already waiting. Apply or discard it first.', 'proposals.draft_waiting');
  }
  const template = (await listIndustryTemplates(db)).find((candidate) => candidate.key === input.templateKey);
  if (!template) throw new DomainError('That starting point is not available.', 'templates.not_found');
  const { shape } = await fitShapeToPlan(db, input.organizationId, template.shape);

  const { data, error } = await db
    .from('configuration_proposals')
    .insert({
      organization_id: input.organizationId,
      description: template.name,
      shape: shape as never,
      drafted_by: 'Starting template',
      created_by: actor.id,
      template_key: template.key,
      origin: 'template',
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot set up this business.', 'proposals.forbidden');
    throw new DomainError(error.message, 'proposals.create_failed');
  }
  return toProposal(data);
}

/** The other businesses this person manages, which a new business may copy its setup from. */
export async function listCopySources(db: Db, input: { organizationId: string }): Promise<{ id: string; name: string }[]> {
  return (await listMyOrganizations(db))
    .filter((organization) => organization.id !== input.organizationId && organization.capabilities.includes('organization.manage'))
    .map((organization) => ({ id: organization.id, name: organization.name }));
}

/**
 * Open another business's setup as a draft for this one: read it back (`readBusinessSetup`, which
 * never reads customers, jobs or money), leave out what this business's plan does not include, and
 * label it with where it came from. Nothing is applied until the owner applies it.
 */
export async function draftFromBusiness(
  db: Db,
  input: { organizationId: string; sourceOrganizationId: string },
): Promise<ConfigurationProposal> {
  const actor = await requireActor(db);
  const waiting = await currentConfigurationProposal(db, { organizationId: input.organizationId });
  if (waiting) {
    throw new DomainError('A setup is already waiting. Apply or discard it first.', 'proposals.draft_waiting');
  }
  const source = (await listCopySources(db, input)).find((candidate) => candidate.id === input.sourceOrganizationId);
  if (!source) throw new DomainError('You can only copy a business you manage.', 'proposals.copy_forbidden');
  const { shape } = await fitShapeToPlan(db, input.organizationId, await readBusinessSetup(db, source.id));

  const { data, error } = await db
    .from('configuration_proposals')
    .insert({
      organization_id: input.organizationId,
      description: source.name,
      shape: shape as never,
      drafted_by: 'Copied setup',
      created_by: actor.id,
      origin: 'copied',
      copied_from: source.id,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot set up this business.', 'proposals.forbidden');
    throw new DomainError(error.message, 'proposals.create_failed');
  }
  return toProposal(data);
}

/** Every template, published or not, for platform staff who look after them (`platform.catalogue`). */
export async function listManagedIndustryTemplates(db: Db): Promise<ManagedIndustryTemplate[]> {
  const { data, error } = await db
    .from('industry_templates')
    .select('key, name, category, description, shape, published')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new DomainError(error.message, 'templates.list_failed');
  return (data ?? []).map((row) => ({ ...row, shape: readBusinessShape(row.shape) }));
}

/** A key a template can be found by: its name in plain letters, made unique. */
function templateKeyFor(name: string): string {
  const stem = name.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 36);
  return `${stem || 'template'}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/** A template's category: the industry a new owner types that pre-selects it. */
function templateCategory(value: string): string {
  const category = value.trim();
  if (!category || category.length > 60) throw new DomainError('Give the template a category of up to 60 characters.', 'templates.category_invalid');
  return category;
}

/** The industry a business gave, as staff saving it as a template see it; null when it gave none or has no setup to read. */
export async function businessIndustry(db: Db, organizationId: string): Promise<string | null> {
  try {
    return (await readBusinessSetupWithIndustry(db, organizationId)).industry;
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/**
 * Save a business's setup as a starting template, unpublished: platform staff look it over and
 * publish it when it is ready. Read with `readBusinessSetup`, so it carries no customer, job or
 * money data. Filed under the category staff choose — by default the business's own industry —
 * which is what pre-selects it for a new owner who gives that industry.
 */
export async function saveBusinessAsTemplate(
  db: Db,
  input: { organizationId: string; name: string; description: string; category?: string },
): Promise<string> {
  await requireActor(db);
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || name.length > 120) throw new DomainError('Give the template a name of up to 120 characters.', 'templates.name_invalid');
  if (!description || description.length > 300) throw new DomainError('Describe the template in up to 300 characters.', 'templates.description_invalid');
  const { shape, industry } = await readBusinessSetupWithIndustry(db, input.organizationId);
  const category = input.category?.trim() ? templateCategory(input.category) : (industry ?? '').trim().slice(0, 60) || 'Other';
  const { data: last } = await db.from('industry_templates').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
  const key = templateKeyFor(name);
  const { error } = await db.from('industry_templates').insert({
    key,
    name,
    category,
    description,
    shape: shape as never,
    published: false,
    position: (last?.position ?? 0) + 10,
  });
  if (error) {
    if (error.code === '42501') throw new DomainError('Only staff who look after the catalogue can save templates.', 'templates.forbidden');
    throw new DomainError(error.message, 'templates.save_failed');
  }
  return key;
}

/** Offer a template to new businesses, or stop offering it. A business that started from it keeps what it applied. */
export async function setIndustryTemplatePublished(db: Db, input: { key: string; published: boolean }): Promise<void> {
  await requireActor(db);
  const { data, error } = await db.from('industry_templates')
    .update({ published: input.published, updated_at: new Date().toISOString() })
    .eq('key', input.key).select('key').maybeSingle();
  if (error || !data) throw new DomainError('Only staff who look after the catalogue can change templates.', 'templates.forbidden');
}

/** Rename a template, and refile it under another category when one is given. */
export async function renameIndustryTemplate(db: Db, input: { key: string; name: string; category?: string }): Promise<void> {
  await requireActor(db);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new DomainError('Give the template a name of up to 120 characters.', 'templates.name_invalid');
  const category = input.category === undefined ? undefined : templateCategory(input.category);
  const { data, error } = await db.from('industry_templates')
    .update({ name, ...(category ? { category } : {}), updated_at: new Date().toISOString() })
    .eq('key', input.key).select('key').maybeSingle();
  if (error || !data) throw new DomainError('Only staff who look after the catalogue can change templates.', 'templates.forbidden');
}
