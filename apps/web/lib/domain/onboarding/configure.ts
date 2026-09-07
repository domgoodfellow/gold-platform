import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
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
} from '@/lib/domain/automation/rules';
import { setBrand } from '@/lib/domain/branding/brand';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { createRole } from '@/lib/domain/tenancy/roles';
import { publicProfile, setPublicProfile } from '@/lib/domain/tenancy/profile';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition } from '@/lib/domain/work-items/transitions';
import { createWorkItemType } from '@/lib/domain/work-items/types';

/**
 * Standing a whole business up from data, in one function with no branch in it —
 * `milestone-m3.test.ts` asserts that by reading this function's own source. `BusinessShape` is
 * a type rather than an argument list because a proposal has to survive being generated,
 * rendered, edited by a human, and only then applied (the second caller is M8's onboarding
 * flow). Not a business template — nothing here is seeded or known to the platform in advance.
 * Creates no customer and no job, since inventing one would be the platform speaking for a
 * business that hasn't said anything (D6, D20). Not atomic: each call is its own transaction,
 * so a failure partway leaves a partly-configured business — the same state a business
 * configuring by hand can be in, and every screen already handles it.
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
 * One rule, as data. Statuses by index (same reason transitions are): a shape is written before
 * anything has an id, and a name is a string a proposal can get subtly wrong twice.
 * Deliberately the smallest rule that is a whole rule — conditions, messages, timings and
 * counters are all expressible later, but nothing has asked for a conditional one yet.
 */
export type ShapeAutomation = {
  /** What this business calls the rule. Rendered as written, never translated. */
  name: string;
  /** An `events.action` this platform publishes — see `TRIGGER_EVENTS`. */
  on: string;
  /** Which status to move the job into, as an index into `statuses`. */
  moveTo: number;
};

/**
 * A business, as data. The platform supplies `Customer`, `Work Item`, `Resource` and `Event`
 * (vision.md's non-negotiable primitives); every word describing them here belongs to the tenant.
 */
export type BusinessShape = {
  /** What this business calls the work it does. */
  typeName: string;
  /** Its lifecycle, in its own words and its own length. */
  statuses: string[];
  /** Which moves are legal, as index pairs — an empty list means this business hasn't said how its work moves, and a type with none is frozen rather than unconstrained (I13). */
  transitions: [number, number][];
  /** Its own form, in its own order — `position` is applied explicitly below. */
  fields: Partial<Record<CustomFieldEntity, ShapeField[]>>;
  /** What it charges for. Amounts are minor units in *its* currency (I10). */
  prices: { name: string; unit: string; amountMinor: number }[];
  /** When it is open. Empty means it has said nothing, which is treated as always open. */
  hours: { dayOfWeek: number; opensAt: string; closesAt: string }[];
  /** Roles that are not the founder's, holding what this business decided it needs. */
  roles: { name: string; capabilities: string[] }[];
  /** Optional — a business that automates nothing is ordinary, and a shape written before M6 existed is still valid. */
  automations?: ShapeAutomation[];
  /** What it says about itself. The only prose field in a shape — a public page with no tagline is honest and blank, but a business that just described itself has already said the thing that belongs there. Optional; empty strings clear rather than write. */
  voice?: { tagline: string; intro: string };
  /** How it looks — a colour and a pair of lettering choices. Optional, and no branch on what kind of business this is: a colour is a colour, whoever chose it. */
  brand?: { accent: string; headingFont: string; bodyFont: string };
};

/** What standing a business up produced, so a caller can carry on working with it. */
export type ConfiguredBusiness = {
  organizationId: string;
  typeId: string;
  /** In `shape.statuses` order, so an index into one indexes the other. */
  statusIds: string[];
  roleIds: string[];
  priceBookItemIds: string[];
  /** In `shape.automations` order, so an index into one indexes the other. */
  automationRuleIds: string[];
};

/** Checked up front rather than left to fail on the fourth call — the caller here is often a model, and an out-of-range index is exactly what it will produce. */
function validateTransitions(shape: BusinessShape): void {
  for (const pair of shape.transitions) {
    for (const index of pair) {
      if (!Number.isInteger(index) || index < 0 || index >= shape.statuses.length) {
        throw new DomainError(
          `A transition names status ${index}, and this business has ${shape.statuses.length}.`,
          'onboarding.transition_out_of_range',
        );
      }
    }
  }

  for (const automation of shape.automations ?? []) {
    if (
      !Number.isInteger(automation.moveTo) ||
      automation.moveTo < 0 ||
      automation.moveTo >= shape.statuses.length
    ) {
      throw new DomainError(
        `A rule names status ${automation.moveTo}, and this business has ${shape.statuses.length}.`,
        'onboarding.automation_out_of_range',
      );
    }
  }
}

/**
 * Configure a business that already exists — it no longer creates one, since `createRole` and
 * everything after it run against policies keyed to `app.current_tenant_ids()`, and platform
 * staff are a member of nothing (I21). Standing a business up is two acts by two parties (D29):
 * GOLD creates it (`provisionOrganization`), and whoever does the configuring configures it —
 * today the owner, at M8 the same call made after a human reviews a proposal. What hasn't
 * changed is the fixed sequence of domain calls with no branch on which business this is.
 */
export async function configureBusiness(
  db: Db,
  organizationId: string,
  shape: BusinessShape,
): Promise<ConfiguredBusiness> {
  validateTransitions(shape);

  const roleIds: string[] = [];
  for (const role of shape.roles) {
    roleIds.push(
      await createRole(db, {
        organizationId,
        name: role.name,
        capabilities: role.capabilities,
      }),
    );
  }

  const typeId = await createWorkItemType(db, { organizationId, name: shape.typeName });

  const statusIds: string[] = [];
  for (const [position, name] of shape.statuses.entries()) {
    statusIds.push(await createWorkItemStatus(db, { organizationId, typeId, name, position }));
  }

  for (const [from, to] of shape.transitions) {
    await createWorkItemTransition(db, {
      organizationId,
      typeId,
      fromStatusId: statusIds[from],
      toStatusId: statusIds[to],
    });
  }

  // The form, then its order — definitions are appended as created, so a business wanting a different order says so in a second pass.
  const entries = Object.entries(shape.fields) as [CustomFieldEntity, ShapeField[]][];
  for (const [entityType, fields] of entries) {
    for (const field of fields) {
      await createFieldDefinition(db, { organizationId, entityType, ...field });
    }

    const defined = await listFieldDefinitions(db, { organizationId, entityType });
    for (const definition of defined) {
      const position = fields.findIndex((field) => field.key === definition.key);
      // A definition this shape didn't ask for belongs to somebody else's ordering and is left where it is.
      if (position === -1) continue;
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

  for (const hours of shape.hours) {
    await addOperatingHours(db, { organizationId, ...hours });
  }

  const priceBookItemIds: string[] = [];
  for (const price of shape.prices) {
    priceBookItemIds.push(
      await createPriceBookItem(db, {
        organizationId,
        name: price.name,
        unit: price.unit,
        unitAmountMinor: price.amountMinor,
      }),
    );
  }

  // Last, because a rule names a status and the statuses are already written above it.
  const automationRuleIds: string[] = [];
  for (const automation of shape.automations ?? []) {
    const ruleId = await createAutomationRule(db, {
      organizationId,
      name: automation.name,
      triggerKind: 'event',
      triggerEventAction: automation.on,
    });
    await addAutomationAction(db, {
      organizationId,
      ruleId,
      kind: 'change_status',
      statusId: statusIds[automation.moveTo],
    });
    automationRuleIds.push(ruleId);
  }

  // Last, and after everything else that can fail on a capability — a business's look and voice
  // are `organization.manage`, so a member who may operate but not rename the business still
  // gets the whole operational setup before being refused here.
  if (shape.voice) {
    // Read first — `setPublicProfile` writes the whole row, and a shape carries only two of its
    // six fields; passing empty strings for the rest would clear a phone number already typed in.
    const existing = await publicProfile(db, { organizationId, fallbackName: '' });

    await setPublicProfile(db, {
      organizationId,
      // Not part of the voice — a business's display name is `organizations.name` until it says otherwise.
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

  return { organizationId, typeId, statusIds, roleIds, priceBookItemIds, automationRuleIds };
}
