import type { Db } from '@/lib/db/types';
import { readBusinessShape, workTypesOf } from './shape';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import {
  createFieldDefinition,
  listFieldDefinitions,
  updateFieldDefinition,
  type CustomFieldEntity,
  type FieldKind,
} from '@/lib/domain/fields/field-definitions';
import {
  addAutomationAction,
  createAutomationRule,
  listAutomationRules,
} from '@/lib/domain/automation/rules';
import { setBrand } from '@/lib/domain/branding/brand';
import { createForm, listForms, publishFormRevision } from '@/lib/domain/forms/forms';
import { setPortalForm } from '@/lib/domain/portal/portal-forms';
import { createPriceBookItem, listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { createResourceCapability, listResourceCapabilities } from '@/lib/domain/resources/resource-capabilities';
import type { ResourceClass } from '@/lib/domain/resources/resource-class';
import { addOperatingHours, listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { createRole, listRoles } from '@/lib/domain/tenancy/roles';
import { getBusinessProfile, saveBusinessProfile, type BusinessEntity } from '@/lib/domain/tenancy/business-profile';
import { enableOrganizationFeature, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { MODULES, isModuleKey, type ModuleKey } from '@/lib/navigation';
import { publicProfile, setPublicProfile } from '@/lib/domain/tenancy/profile';
import { addTypeChecklistItem, listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { createResourceRequirement, listResourceRequirements } from '@/lib/domain/work-items/requirements';
import { createWorkItemStatus, listWorkItemStatuses, updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition, listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { createWorkItemType, getTypeBooking, listWorkItemTypes, setTypeBookable, setTypeBookingPolicy } from '@/lib/domain/work-items/types';
import { getOrganizationIdentity, isBusinessServes, setBusinessServes, type BusinessServes } from '@/lib/domain/tenancy/identity';

/**
 * Standing a business up from reviewed data through its canonical owners. `BusinessShape` is
 * a type rather than an argument list because a proposal has to survive being generated,
 * rendered, edited by a human, and only then applied. It may start from an industry template
 * (`industry_templates`), but nothing here knows that: a template is only where a reviewed
 * document came from. Creates no customer and no job, since inventing one would be the platform
 * speaking for a business that hasn't said anything.
 *
 * **Safe to run again, not atomic.** Each step is its own transaction, so a failure part-way
 * leaves a partly configured business — the same state a business configuring by hand can be in.
 * Every step first looks for what an earlier run made (a role, kind of work, stage, move, step,
 * need, field, opening, price, rule, form by its name or key) and only creates what is missing,
 * so applying the same document again finishes the setup without duplicates. All-or-nothing would
 * need one privileged database function taking the document as JSON — a second configuration path
 * beside the canonical owners this calls, which is the mistake the one-creation-path rule forbids.
 */

/** One custom field, on whichever entity carries it. */
export type ShapeField = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Optional, so a shape written before choices existed is still valid — a choosing kind with none is refused by `createFieldDefinition`. */
  options?: string[];
};

/**
 * One rule, as data. Stages by index (same reason transitions are): a shape is written before
 * anything has an id, and a name is a string a proposal can get subtly wrong twice.
 * Deliberately the smallest rule that is a whole rule — conditions, messages, timings and
 * counters are all expressible later, but nothing has asked for a conditional one yet.
 */
export type ShapeAutomation = {
  /** What this business calls the rule. Rendered as written, never translated. */
  name: string;
  /** An `events.action` this platform publishes — see `TRIGGER_EVENTS`. */
  on: string;
  /** Which stage to move the job into, as an index into its kind of work's stages. */
  moveTo: number;
};

/** A stage, and the two questions the platform asks about it. Unset means no. */
export type ShapeStage = {
  name: string;
  /** Work in this stage stops holding its resource ("Cancelled", "No answer"). */
  releasesResource?: boolean;
  /** Moving into this stage means the work was done. */
  marksComplete?: boolean;
};

/** What one piece of this work needs: a kind of resource, how many, and what each must be able to do. */
export type ShapeRequirement = { resourceClass: ResourceClass; quantity: number; capabilities?: string[] };

/**
 * How customers may book it, when that differs from the platform's own settings: start times every
 * `cadenceMinutes` (null: every booking length), notice and how far ahead, the same day, until when
 * a customer may reschedule or cancel (null: until it starts), and which stage a customer's
 * cancellation moves it to (an index; null: customers cannot cancel).
 */
export type ShapeBookingPolicy = {
  cadenceMinutes: number | null;
  minimumNoticeMinutes: number;
  horizonDays: number;
  allowSameDay: boolean;
  rescheduleCutoffMinutes: number | null;
  cancelCutoffMinutes: number | null;
  cancellationStage: number | null;
};

/** What a newly bookable kind of work starts with; a policy equal to this is left out of a document. */
export const DEFAULT_BOOKING_POLICY: ShapeBookingPolicy = {
  cadenceMinutes: null, minimumNoticeMinutes: 0, horizonDays: 365, allowSameDay: true,
  rescheduleCutoffMinutes: null, cancelCutoffMinutes: null, cancellationStage: null,
};

/** Customers may book this work online, arriving in `stage`, for `durationMinutes`. */
export type ShapeBooking = { stage: number; durationMinutes: number; policy?: ShapeBookingPolicy };

/** One kind of work, in this business's words, with its own stages and settings. */
export type ShapeWorkType = {
  name: string;
  /** Whether this work happens at a time and belongs in Schedule. Stated, never derived. */
  schedulable: boolean;
  stages: ShapeStage[];
  /** Which moves are legal, as index pairs into `stages`. Empty means the work cannot move. */
  transitions: [number, number][];
  /** Steps copied onto each new job of this kind. */
  checklist?: string[];
  /** Only for scheduled work. */
  requirements?: ShapeRequirement[];
  /** Only for scheduled work. */
  booking?: ShapeBooking;
  automations?: ShapeAutomation[];
};

/** The business's own words for the platform's nouns and destinations, and the order of its menu. */
export type ShapeWording = {
  nouns?: Partial<Record<BusinessEntity, { singular: string; plural: string }>>;
  labels?: Record<string, string>;
  navigation?: string[];
};

/** Which of its forms, started from a form template, this business's customers can send from the portal. */
export type ShapePortal = { forms: { template: string; name: string }[] };

/**
 * A business, as data. The platform supplies `Customer`, `Work Item`, `Resource` and `Event`
 * (the platform's fixed primitives); every word describing them here belongs to the tenant.
 *
 * The kinds of work are written one of two ways. `workTypes` holds any number, each with its
 * stages and settings. The original single-type form (`typeName`, `schedulable`, `statuses`,
 * `transitions`, `automations`) is still accepted, because drafting writes it and stored
 * proposals hold it; `readBusinessShape` accepts one form or the other, never both.
 */
export type BusinessShape = {
  workTypes?: ShapeWorkType[];
  /** Single-type form: what this business calls the work it does. */
  typeName?: string;
  /** Single-type form: whether that work is scheduled. A document written before this existed is refused rather than answered for. */
  schedulable?: boolean;
  /** Single-type form: its lifecycle, in its own words and its own length. */
  statuses?: string[];
  /** Single-type form: which moves are legal, as index pairs into `statuses`. */
  transitions?: [number, number][];
  /** Single-type form: rules, by index into `statuses`. */
  automations?: ShapeAutomation[];
  /** Its own form, in its own order — `position` is applied explicitly below. `customer` holds the customer side's default fields. */
  fields: Partial<Record<CustomFieldEntity, ShapeField[]>>;
  /** What it charges for. Amounts are minor units in *its* currency. */
  prices: { name: string; unit: string; amountMinor: number }[];
  /** When it is open. Empty means it has said nothing, which is treated as always open. */
  hours: { dayOfWeek: number; opensAt: string; closesAt: string }[];
  /** Roles that are not the founder's, holding what this business decided it needs. */
  roles: { name: string; capabilities: string[] }[];
  /**
   * What this business is switching on. Switching one on is never switching one off — a module
   * absent from this list is left alone, because a proposal is a description of a business and
   * not an inventory of it.
   */
  modules?: ModuleKey[];
  /** Individually reviewed catalogue activations. They never purchase entitlement. */
  featureKeys?: string[];
  /** What it says about itself on its public page. Optional; empty strings clear rather than write. */
  voice?: { tagline: string; intro: string };
  /** How it looks — a colour and a pair of lettering choices. */
  brand?: { accent: string; headingFont: string; bodyFont: string };
  /** Its words for customers, work and the rest, and the order of its menu. */
  wording?: ShapeWording;
  /** What its customers can send in from the portal. */
  portal?: ShapePortal;
  /** Who it serves: people, companies or both. */
  serves?: BusinessServes;
};

/** What standing a business up produced, so a caller can carry on working with it. */
export type ConfiguredBusiness = {
  organizationId: string;
  /** The first kind of work, kept for callers written when there was one. */
  typeId: string;
  /** The first kind of work's stages, in order. */
  statusIds: string[];
  /** Every kind of work, in shape order, with its stages in order. */
  workTypes: { typeId: string; statusIds: string[] }[];
  roleIds: string[];
  priceBookItemIds: string[];
  /** In rule order, kind of work by kind of work. */
  automationRuleIds: string[];
  /** Historical grouped activation selections, not a list of purchases or new entitlements. */
  moduleKeys: ModuleKey[];
};

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** Checked up front rather than left to fail on the fourth call — the caller here is often a model, and an out-of-range index is exactly what it will produce. */
function validateWorkTypes(types: ShapeWorkType[], hours: BusinessShape['hours']): void {
  for (const [at, type] of types.entries()) {
    if (types.some((other, index) => index < at && same(other.name, type.name))) {
      throw new DomainError(`Two kinds of work are both called ${type.name}.`, 'configuration.work_type_duplicate');
    }
    const count = type.stages.length;
    const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < count;
    for (const pair of type.transitions) {
      for (const index of pair) {
        if (!inRange(index)) {
          throw new DomainError(`A move in ${type.name} names stage ${index}, and it has ${count}.`, 'configuration.transition_out_of_range');
        }
      }
    }
    for (const automation of type.automations ?? []) {
      if (!inRange(automation.moveTo)) {
        throw new DomainError(`A rule in ${type.name} names stage ${automation.moveTo}, and it has ${count}.`, 'configuration.automation_out_of_range');
      }
    }
    if (type.booking && !inRange(type.booking.stage)) {
      throw new DomainError(`Online booking for ${type.name} names stage ${type.booking.stage}, and it has ${count}.`, 'configuration.booking_out_of_range');
    }
    const cancelled = type.booking?.policy?.cancellationStage;
    if (cancelled !== undefined && cancelled !== null && !inRange(cancelled)) {
      throw new DomainError(`Online booking for ${type.name} cancels into stage ${cancelled}, and it has ${count}.`, 'configuration.booking_out_of_range');
    }
    if (!type.schedulable && (type.booking || type.requirements?.length)) {
      throw new DomainError(`${type.name} is not scheduled, so it cannot be booked online or need resources.`, 'configuration.unscheduled_settings');
    }
  }
  if (hours.length > 0 && !types.some((type) => type.schedulable)) {
    throw new DomainError(
      'Opening hours belong to work that is scheduled, and this setup says its work is not.',
      'configuration.hours_without_schedule',
    );
  }
}

/**
 * Checked up front for the same reason transitions are: the caller is often a model, and a name
 * it invented or a dependency it did not notice must fail before the first write rather than
 * after the fourth. `requires` is checked against the whole list rather than against what the
 * business already has, because both arrive in the same call.
 */
function validateModules(shape: BusinessShape): void {
  const asked = shape.modules ?? [];

  for (const key of asked) {
    if (!isModuleKey(key)) {
      throw new DomainError(
        `GildOps has no feature called ${key}.`,
        'configuration.module_unknown',
      );
    }
  }

  for (const key of asked) {
    // Not named `module`: Next forbids assigning to that identifier (`@next/next/no-assign-module-variable`).
    const sold = MODULES.find((entry) => entry.key === key);
    const needs =
      sold && 'requires' in sold ? (sold.requires as ModuleKey | undefined) : undefined;
    if (needs && !asked.includes(needs)) {
      const label = MODULES.find((entry) => entry.key === needs)?.label ?? needs;
      throw new DomainError(
        `${sold?.label} does nothing without ${label}, which this setup does not switch on.`,
        'configuration.module_requires',
      );
    }
  }
}

/** A role, kind of work or anything else named here is found by its name before it is made, so a second run makes nothing twice. */
async function findOrCreate<T extends { id: string }>(existing: T[], match: (row: T) => boolean, create: () => Promise<string>): Promise<string> {
  return existing.find(match)?.id ?? create();
}

/**
 * Configure a business that already exists. Standing a business up is two acts by two parties:
 * GOLD or its founder creates it, and whoever does the configuring configures it — the owner,
 * after a person has reviewed the document. A fixed sequence of domain calls with no branch on
 * which business this is.
 */
export async function configureBusiness(
  db: Db,
  organizationId: string,
  shape: BusinessShape,
): Promise<ConfiguredBusiness> {
  shape = readBusinessShape(shape);
  if (!shape.workTypes && typeof shape.schedulable !== 'boolean') {
    throw new DomainError('This setup does not say whether the work is scheduled.', 'configuration.schedulable_missing');
  }
  const types = workTypesOf(shape);
  validateWorkTypes(types, shape.hours);
  validateModules(shape);
  const featureStates = shape.modules?.length || shape.featureKeys?.length ? await organizationResolvedFeatureStates(db, { organizationId }) : [];
  for (const key of shape.featureKeys ?? []) {
    if (!featureStates.some((state) => state.featureKey === key && state.entitled && state.implementationState === 'available')) {
      throw new DomainError('This proposal includes a feature unavailable to this business.', 'configuration.feature_not_entitled');
    }
  }
  for (const key of shape.modules ?? []) {
    if (!featureStates.some((state) => state.moduleKey === key && state.entitled && state.implementationState === 'available')) {
      throw new DomainError('This setup includes a feature outside this business’s plan.', 'configuration.module_not_entitled');
    }
  }

  const existingRoles = await listRoles(db, { organizationId });
  const roleIds: string[] = [];
  for (const role of shape.roles) {
    roleIds.push(await findOrCreate(existingRoles, (row) => same(row.name, role.name), () =>
      createRole(db, { organizationId, name: role.name, capabilities: role.capabilities })));
  }

  // Resource capabilities named by any need, found by name or added to the vocabulary once.
  const capabilityIds = new Map<string, string>();
  const needed = [...new Set(types.flatMap((type) => (type.requirements ?? []).flatMap((need) => need.capabilities ?? [])))];
  if (needed.length) {
    const vocabulary = await listResourceCapabilities(db, { organizationId, includeArchived: true });
    for (const name of needed) {
      capabilityIds.set(name, await findOrCreate(vocabulary, (row) => same(row.name, name), () => createResourceCapability(db, { organizationId, name })));
    }
  }

  const existingTypes = await listWorkItemTypes(db, { organizationId });
  const configuredTypes: ConfiguredBusiness['workTypes'] = [];
  for (const type of types) {
    const typeId = await findOrCreate(existingTypes, (row) => same(row.name, type.name), () =>
      createWorkItemType(db, { organizationId, name: type.name, schedulable: type.schedulable }));

    const existingStages = await listWorkItemStatuses(db, { organizationId, typeId });
    const statusIds: string[] = [];
    for (const [position, stage] of type.stages.entries()) {
      const found = existingStages.find((row) => same(row.name, stage.name));
      const id = found?.id ?? await createWorkItemStatus(db, { organizationId, typeId, name: stage.name, position });
      statusIds.push(id);
      // The single-type form says nothing about consequences, so its stages are left as created.
      if (stage.releasesResource === undefined && stage.marksComplete === undefined) continue;
      const releasesResource = stage.releasesResource ?? false;
      const marksComplete = stage.marksComplete ?? false;
      if (found && found.releasesResource === releasesResource && found.marksComplete === marksComplete) continue;
      if (!found && !releasesResource && !marksComplete) continue;
      await updateWorkItemStatus(db, { id, name: stage.name.trim(), position: found?.position ?? position, releasesResource, marksComplete });
    }

    const existingMoves = await listWorkItemTransitions(db, { organizationId, typeId });
    for (const [from, to] of type.transitions) {
      if (existingMoves.some((move) => move.fromStatusId === statusIds[from] && move.toStatusId === statusIds[to])) continue;
      await createWorkItemTransition(db, { organizationId, typeId, fromStatusId: statusIds[from], toStatusId: statusIds[to] });
    }

    if (type.checklist?.length) {
      const steps = await listTypeChecklistItems(db, { organizationId, typeId });
      for (const label of type.checklist) {
        if (steps.some((step) => same(step.label, label))) continue;
        await addTypeChecklistItem(db, { organizationId, typeId, label });
      }
    }

    if (type.requirements?.length) {
      const needs = await listResourceRequirements(db, { organizationId, typeId });
      for (const need of type.requirements) {
        const ids = (need.capabilities ?? []).map((name) => capabilityIds.get(name)!).sort();
        const met = needs.some((row) => row.resourceClass === need.resourceClass && row.quantity === need.quantity
          && row.capabilities.map((capability) => capability.id).sort().join() === ids.join());
        if (met) continue;
        await createResourceRequirement(db, { typeId, resourceClass: need.resourceClass, quantity: need.quantity, capabilityIds: ids });
      }
    }

    configuredTypes.push({ typeId, statusIds });
  }

  // The form, then its order — definitions are appended as created, so a business wanting a different order says so in a second pass.
  const entries = Object.entries(shape.fields) as [CustomFieldEntity, ShapeField[]][];
  for (const [entityType, fields] of entries) {
    const before = await listFieldDefinitions(db, { organizationId, entityType });
    for (const field of fields) {
      if (before.some((definition) => definition.key === field.key)) continue;
      await createFieldDefinition(db, { organizationId, entityType, ...field });
    }

    const defined = await listFieldDefinitions(db, { organizationId, entityType });
    for (const definition of defined) {
      const position = fields.findIndex((field) => field.key === definition.key);
      // A definition this shape didn't ask for belongs to somebody else's ordering and is left where it is.
      if (position === -1 || definition.position === position) continue;
      // Carries `kind` and `options` rather than omitting them — this call writes the whole row, so leaving them out would reorder a business's form and empty every dropdown on it.
      await updateFieldDefinition(db, {
        id: definition.id,
        label: definition.label,
        required: definition.required,
        position,
        kind: definition.kind,
        options: definition.options,
      });
    }
  }

  if (shape.hours.length) {
    const open = await listOperatingHours(db, { organizationId });
    for (const hours of shape.hours) {
      const already = open.some((row) => row.dayOfWeek === hours.dayOfWeek
        && row.opensAt.slice(0, 5) === hours.opensAt.slice(0, 5) && row.closesAt.slice(0, 5) === hours.closesAt.slice(0, 5));
      if (already) continue;
      await addOperatingHours(db, { organizationId, ...hours });
    }
  }

  const existingPrices = shape.prices.length ? await listPriceBookItems(db, { organizationId }) : [];
  const priceBookItemIds: string[] = [];
  for (const price of shape.prices) {
    priceBookItemIds.push(await findOrCreate(existingPrices, (row) => same(row.name, price.name), () =>
      createPriceBookItem(db, { organizationId, name: price.name, unit: price.unit, unitAmountMinor: price.amountMinor })));
  }

  // After the stages, because a rule names one.
  const automationRuleIds: string[] = [];
  if (types.some((type) => type.automations?.length)) {
    const rules = await listAutomationRules(db, { organizationId });
    for (const [at, type] of types.entries()) {
      for (const automation of type.automations ?? []) {
        const found = rules.find((rule) => same(rule.name, automation.name));
        const ruleId = found?.id ?? await createAutomationRule(db, {
          organizationId,
          name: automation.name,
          triggerKind: 'event',
          triggerEventAction: automation.on,
        });
        // A rule made by a run that stopped before its action gets the action now.
        if (!found?.actions.some((action) => action.kind === 'change_status')) {
          await addAutomationAction(db, {
            organizationId,
            ruleId,
            kind: 'change_status',
            statusId: configuredTypes[at].statusIds[automation.moveTo],
          });
        }
        automationRuleIds.push(ruleId);
      }
    }
  }

  // **Down here, and not first, because of the capability it needs.** Switching a module on is
  // `organization.manage`: a member who may operate but not rename the business gets the whole
  // operational setup before anything refuses them. Switching on is idempotent.
  const moduleKeys: ModuleKey[] = [];
  for (const key of shape.modules ?? []) {
    for (const state of featureStates.filter((state) => state.moduleKey === key && state.entitled && state.implementationState === 'available')) {
      await enableOrganizationFeature(db, { organizationId, featureId: state.featureId });
    }
    moduleKeys.push(key);
  }

  for (const key of new Set(shape.featureKeys ?? [])) {
    const state = featureStates.find((state) => state.featureKey === key)!;
    await enableOrganizationFeature(db, { organizationId, featureId: state.featureId });
  }

  // After the modules, because taking bookings is one of them.
  for (const [at, type] of types.entries()) {
    if (!type.booking) continue;
    const { typeId, statusIds } = configuredTypes[at];
    const current = await getTypeBooking(db, { organizationId, typeId });
    if (current?.statusId !== statusIds[type.booking.stage] || current.durationMinutes !== type.booking.durationMinutes) {
      await setTypeBookable(db, { id: typeId, statusId: statusIds[type.booking.stage], durationMinutes: type.booking.durationMinutes, priceItemId: current?.priceItemId ?? null });
    }
    const policy = type.booking.policy;
    if (!policy) continue;
    // Read through the booking domain, which owns the policy columns; start times every booking length reads as that length.
    const stored = (await getTypeBooking(db, { organizationId, typeId }))?.policy;
    const cancellationStatusId = policy.cancellationStage === null ? null : statusIds[policy.cancellationStage];
    if (stored && stored.cadenceMinutes === (policy.cadenceMinutes ?? type.booking.durationMinutes) && stored.minimumNoticeMinutes === policy.minimumNoticeMinutes
      && stored.maximumHorizonDays === policy.horizonDays && stored.allowSameDay === policy.allowSameDay
      && stored.customerRescheduleCutoffMinutes === policy.rescheduleCutoffMinutes && stored.customerCancellationCutoffMinutes === policy.cancelCutoffMinutes
      && stored.cancellationStatusId === cancellationStatusId) continue;
    await setTypeBookingPolicy(db, {
      typeId,
      policy: {
        // Null keeps start times on the booking length, as a business that never chose one has.
        cadenceMinutes: policy.cadenceMinutes as number,
        minimumNoticeMinutes: policy.minimumNoticeMinutes,
        maximumHorizonDays: policy.horizonDays,
        allowSameDay: policy.allowSameDay,
        customerRescheduleCutoffMinutes: policy.rescheduleCutoffMinutes,
        customerCancellationCutoffMinutes: policy.cancelCutoffMinutes,
        cancellationStatusId,
      },
    });
  }

  if (shape.serves && (await getOrganizationIdentity(db, organizationId)).serves !== shape.serves) {
    await setBusinessServes(db, { organizationId, serves: shape.serves });
  }

  // The business's words, merged over what it already says — a word this document does not
  // mention keeps whatever the business chose before.
  if (shape.wording) {
    const profile = await getBusinessProfile(db, organizationId);
    const next = {
      revision: profile?.revision ?? 0,
      nouns: { ...(profile?.nouns ?? {}), ...(shape.wording.nouns ?? {}) },
      labels: { ...(profile?.labels ?? {}), ...(shape.wording.labels ?? {}) },
      navigation: shape.wording.navigation ?? profile?.navigation ?? [],
    };
    const changed = JSON.stringify([next.nouns, next.labels, next.navigation]) !== JSON.stringify([profile?.nouns ?? {}, profile?.labels ?? {}, profile?.navigation ?? []]);
    if (changed) await saveBusinessProfile(db, organizationId, next);
  }

  // What customers can send in from the portal: a form of the business's own, started from a
  // form template, published and offered there. Found by name on a second run.
  if (shape.portal?.forms.length) {
    const forms = await listForms(db, organizationId);
    for (const wanted of shape.portal.forms) {
      let formId = forms.find((form) => same(form.name, wanted.name) && !form.archived)?.id;
      if (!formId) {
        const created = await createForm(db, { organizationId, name: wanted.name, templateKey: wanted.template });
        await publishFormRevision(db, { organizationId, revisionId: created.revisionId });
        formId = created.formId;
      }
      await setPortalForm(db, { organizationId, formId, enabled: true });
    }
  }

  if (shape.voice) {
    // Read first — `setPublicProfile` writes the whole row, and a shape carries only two of its
    // six fields; passing empty strings for the rest would clear a phone number already typed in.
    const existing = await publicProfile(db, { organizationId, fallbackName: '' });

    await setPublicProfile(db, {
      organizationId,
      displayName: existing.displayName,
      tagline: shape.voice.tagline,
      intro: shape.voice.intro,
      contactEmail: existing.contactEmail ?? '',
      contactPhone: existing.contactPhone ?? '',
      address: existing.address ?? '',
    });
  }

  if (shape.brand) {
    await setBrand(db, {
      organizationId,
      accent: shape.brand.accent,
      headingFont: shape.brand.headingFont,
      bodyFont: shape.brand.bodyFont,
    });
  }

  return {
    organizationId,
    typeId: configuredTypes[0].typeId,
    statusIds: configuredTypes[0].statusIds,
    workTypes: configuredTypes,
    roleIds,
    priceBookItemIds,
    automationRuleIds,
    moduleKeys,
  };
}

/** What `read_business_setup` returns: a business's setup tables, as rows. */
type SetupRows = {
  industry: string | null;
  serves: string | null;
  types: {
    name: string;
    schedulable: boolean;
    booking: null | {
      status_id: string; duration_minutes: number; cadence_minutes: number | null; minimum_notice_minutes: number;
      horizon_days: number; allow_same_day: boolean; reschedule_cutoff_minutes: number | null;
      cancel_cutoff_minutes: number | null; cancellation_status_id: string | null;
    };
    stages: { id: string; name: string; releases_resource: boolean; marks_complete: boolean }[];
    transitions: { from: string; to: string }[];
    checklist: string[];
    requirements: { resource_class: ResourceClass; quantity: number; capabilities: string[] }[];
  }[];
  fields: { entity: CustomFieldEntity; key: string; label: string; kind: FieldKind; required: boolean; options: string[] | null }[];
  roles: { name: string; capabilities: string[] }[];
  hours: { day_of_week: number; opens_at: string; closes_at: string }[];
  wording: null | { nouns: ShapeWording['nouns'] | null; labels: Record<string, string> | null; navigation: string[] | null };
  brand: null | { accent: string | null; heading_font: string | null; body_font: string | null };
  portal_forms: { template: string; name: string }[];
  automations: { name: string; on: string; status_id: string }[];
};

const filled = (value: object | null | undefined): boolean => value !== null && value !== undefined && Object.keys(value).length > 0;

/**
 * Read a business's current setup back out as a `BusinessShape` — the document `configureBusiness`
 * applies, so what comes out can be applied to another business. Its kinds of work with their
 * stages, moves, steps, needs and online booking; its fields; the roles beside the one it was
 * founded with; its opening hours; its words and menu order; who it serves; its brand colour and
 * lettering; the customer forms it offers that started from a form template; its "on an event,
 * move the job" rules; and the modules it has switched on.
 *
 * **Setup only, never data.** Customers, jobs, invoices, payments, prices, public address, public
 * page text, logo, phone numbers, payment accounts and connected apps stay with the business:
 * `read_business_setup` does not read those tables at all. A person who manages the business may
 * read it, and so may platform staff who look after the starting templates.
 */
export async function readBusinessSetup(db: Db, organizationId: string): Promise<BusinessShape> {
  return (await readBusinessSetupWithIndustry(db, organizationId)).shape;
}

/** The same, with the industry the business gave, which a template saved from it is filed under. */
export async function readBusinessSetupWithIndustry(db: Db, organizationId: string): Promise<{ shape: BusinessShape; industry: string | null }> {
  const { data, error } = await db.rpc('read_business_setup', { p_organization_id: organizationId });
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot read this business’s setup.', 'configuration.read_forbidden');
    throw fromDatabaseError(error, 'configuration.read_failed');
  }
  const rows = data as unknown as SetupRows;
  if (rows.types.length === 0) {
    throw new DomainError('That business has no kinds of work yet, so it has no setup to copy.', 'configuration.nothing_to_read');
  }

  // Which modules are on is the catalogue resolver's answer, read the way every screen reads it.
  // Features outside any module come with the plan itself, so a copy has nothing to switch on there.
  const states = await organizationResolvedFeatureStates(db, { organizationId });
  const usable = states.filter((state) => state.implementationState === 'available' && state.entitled && state.activation === 'active');
  const modules = MODULES.map((entry) => entry.key).filter((key) => usable.some((state) => state.moduleKey === key));

  const workTypes: ShapeWorkType[] = rows.types.map((type) => {
    const at = (id: string | null) => type.stages.findIndex((stage) => stage.id === id);
    const transitions = type.transitions
      .map((move): [number, number] => [at(move.from), at(move.to)])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const automations = rows.automations.filter((rule) => at(rule.status_id) !== -1)
      .map((rule) => ({ name: rule.name, on: rule.on, moveTo: at(rule.status_id) }));
    let booking: ShapeBooking | undefined;
    if (type.booking) {
      const policy: ShapeBookingPolicy = {
        cadenceMinutes: type.booking.cadence_minutes,
        minimumNoticeMinutes: type.booking.minimum_notice_minutes,
        horizonDays: type.booking.horizon_days,
        allowSameDay: type.booking.allow_same_day,
        rescheduleCutoffMinutes: type.booking.reschedule_cutoff_minutes,
        cancelCutoffMinutes: type.booking.cancel_cutoff_minutes,
        cancellationStage: type.booking.cancellation_status_id === null ? null : at(type.booking.cancellation_status_id),
      };
      booking = {
        stage: at(type.booking.status_id),
        durationMinutes: type.booking.duration_minutes,
        // Start times every booking length is what a business that never chose one has.
        ...(JSON.stringify({ ...policy, cadenceMinutes: policy.cadenceMinutes === type.booking.duration_minutes ? null : policy.cadenceMinutes })
          === JSON.stringify(DEFAULT_BOOKING_POLICY) ? {} : { policy }),
      };
    }
    return {
      name: type.name,
      schedulable: type.schedulable,
      stages: type.stages.map((stage) => ({ name: stage.name, releasesResource: stage.releases_resource, marksComplete: stage.marks_complete })),
      transitions,
      ...(type.checklist.length ? { checklist: type.checklist } : {}),
      ...(type.requirements.length ? {
        requirements: type.requirements.map((need) => ({
          resourceClass: need.resource_class, quantity: need.quantity, ...(need.capabilities.length ? { capabilities: need.capabilities } : {}),
        })),
      } : {}),
      ...(booking ? { booking } : {}),
      ...(automations.length ? { automations } : {}),
    };
  });

  const fields: BusinessShape['fields'] = {};
  for (const field of rows.fields) {
    (fields[field.entity] ??= []).push({
      key: field.key, label: field.label, kind: field.kind, required: field.required,
      ...(field.options?.length ? { options: field.options } : {}),
    });
  }

  const wording: ShapeWording = {
    ...(filled(rows.wording?.nouns) ? { nouns: rows.wording!.nouns! } : {}),
    ...(filled(rows.wording?.labels) ? { labels: rows.wording!.labels! } : {}),
    ...(rows.wording?.navigation?.length ? { navigation: rows.wording.navigation } : {}),
  };

  const shape: BusinessShape = {
    workTypes,
    fields,
    prices: [],
    hours: rows.hours.map((hour) => ({ dayOfWeek: hour.day_of_week, opensAt: hour.opens_at, closesAt: hour.closes_at })),
    roles: rows.roles.map((role) => ({ name: role.name, capabilities: [...role.capabilities].sort() })),
    ...(modules.length ? { modules } : {}),
    ...(filled(wording) ? { wording } : {}),
    ...(rows.portal_forms.length ? { portal: { forms: rows.portal_forms } } : {}),
    ...(isBusinessServes(rows.serves) ? { serves: rows.serves } : {}),
    ...(rows.brand?.accent ? { brand: { accent: rows.brand.accent, headingFont: rows.brand.heading_font ?? 'sans', bodyFont: rows.brand.body_font ?? 'sans' } } : {}),
  };
  return { shape: readBusinessShape(shape), industry: rows.industry };
}
