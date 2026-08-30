import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  createFieldDefinition,
  listFieldDefinitions,
  updateFieldDefinition,
  type CustomFieldEntity,
  type FieldKind,
} from '@/lib/domain/fields/field-definitions';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition } from '@/lib/domain/work-items/transitions';
import { createWorkItemType } from '@/lib/domain/work-items/types';

/**
 * Standing a whole business up from data, in one function with no branch in it.
 *
 * **This is `milestone-m3.test.ts`'s `configure`, moved.** That file's structural claim was
 * that exactly one function, taking every word, number, status, field, order, currency, zone
 * and price as *data*, could stand up an equipment hire yard in Amsterdam and a clinic in
 * Tokyo — and that had either shape needed a branch, the function could not exist. The claim
 * held, and then the function sat in a test where nothing but a test could call it.
 *
 * It moves here under this repository's own rule: *if a second caller needs a rule that is
 * currently inline, extract it first, then call it twice.* The second caller is the AI
 * onboarding flow `roadmap.md` M8 describes and `constraints.md` D29 makes self-serve signup
 * conditional on — describe a business in prose, receive a proposed configuration, review it,
 * apply it. `BusinessShape` below is what that proposal *is*, which is why it is a type rather
 * than an argument list: a proposal has to survive being generated, rendered, edited by a
 * human and only then applied, and a function's parameters cannot hold it across those steps.
 *
 * **This is not a business template** (`constraints.md`, *Decided, not yet built*). A template
 * is a named bundle this platform ships and a business starts from; a shape is supplied by a
 * caller. The distinction is the one that record cares about: nothing here is seeded, named,
 * or known to the platform in advance.
 *
 * **It deliberately does not create a customer or a job.** The test's version ended by making
 * one of each so it had something to assert against, and that was evidence rather than
 * configuration — a business that has just been stood up has no customers, and inventing one
 * would be the platform putting words in its mouth exactly where D6 and D20 say it may not.
 *
 * **It is not atomic, and that is the honest limitation.** `create_organization` is a
 * transaction and each call below is a transaction, but the sequence is not one: a failure at
 * the price book leaves an organization with its statuses and no catalogue. Nothing is lost
 * and nothing is corrupt — the result is a partly-configured business, which is a state every
 * screen already handles, because it is also the state of a business somebody is configuring
 * by hand. Making the sequence atomic means one privileged function taking the shape as JSON,
 * which puts the order of these steps in the database; that is a real option and it needs a
 * caller who cannot tolerate the partial state. Neither of the two has said so.
 */

/** One custom field, on whichever entity carries it. */
export type ShapeField = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
};

/**
 * A business, as data.
 *
 * Nothing in this type is a platform decision. The platform supplies `Customer`, `Work Item`,
 * `Resource` and `Event` — `vision.md`'s "what is not negotiable is the primitives" — and
 * every word describing them here belongs to the tenant.
 */
export type BusinessShape = {
  name: string;
  /** The IANA zone this business thinks in. */
  timezone: string;
  /** ISO 4217, this business's own. The platform never picks one (I10). */
  currency: string;
  /** What this business calls the work it does. */
  typeName: string;
  /** Its lifecycle, in its own words and its own length. */
  statuses: string[];
  /**
   * Which moves are legal, as pairs of indices into `statuses`.
   *
   * Indices rather than names, because a shape is written before anything has an id and
   * because a name is a string a proposal can get subtly wrong twice. A type with no
   * transitions is frozen rather than unconstrained (I13), so an empty list is a valid answer
   * and means this business has not said how its work moves.
   */
  transitions: [number, number][];
  /** Its own form, in its own order — `position` is applied explicitly below. */
  fields: Partial<Record<CustomFieldEntity, ShapeField[]>>;
  /** What it charges for. Amounts are minor units in *its* currency (I10). */
  prices: { name: string; unit: string; amountMinor: number }[];
  /** When it is open. Empty means it has said nothing, which is treated as always open. */
  hours: { dayOfWeek: number; opensAt: string; closesAt: string }[];
  /** Roles that are not the founder's, holding what this business decided it needs. */
  roles: { name: string; capabilities: string[] }[];
  /** What the founding member is called here. Per-tenant, never an account name (D19). */
  founderDisplayName: string;
};

/** What standing a business up produced, so a caller can carry on working with it. */
export type ConfiguredBusiness = {
  organizationId: string;
  typeId: string;
  /** In `shape.statuses` order, so an index into one indexes the other. */
  statusIds: string[];
  roleIds: string[];
  priceBookItemIds: string[];
};

/**
 * Every transition names a status this shape actually has.
 *
 * Checked before anything is written rather than left to fail on the fourth call, because the
 * caller this exists for is a language model and an out-of-range index is exactly what it will
 * produce. The message names the offending index, since a proposal is read by a human who has
 * to fix it.
 */
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
}

/**
 * Configure a business from a shape.
 *
 * The caller becomes the founding member, exactly as `createOrganization` has always made
 * them: this adds no second way of arriving. Who does the *configuring* is what D29 separates
 * provisioning from self-serve on, and both paths end here.
 */
export async function configureBusiness(
  db: Db,
  shape: BusinessShape,
): Promise<ConfiguredBusiness> {
  validateTransitions(shape);

  const organizationId = await createOrganization(db, {
    name: shape.name,
    displayName: shape.founderDisplayName,
    timezone: shape.timezone,
    currency: shape.currency,
  });

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

  // The form, then its order. Definitions are appended as they are created, so a business that
  // wants a different order has to say so — which is what the registry gained in M3, and why
  // `position` is a second pass rather than an argument to the first.
  const entries = Object.entries(shape.fields) as [CustomFieldEntity, ShapeField[]][];
  for (const [entityType, fields] of entries) {
    for (const field of fields) {
      await createFieldDefinition(db, { organizationId, entityType, ...field });
    }

    const defined = await listFieldDefinitions(db, { organizationId, entityType });
    for (const definition of defined) {
      const position = fields.findIndex((field) => field.key === definition.key);
      // A definition this shape did not ask for belongs to somebody else's ordering, and is
      // left where it is. There are none today; there will be the first time a shape is
      // applied to a business that already has fields.
      if (position === -1) continue;
      await updateFieldDefinition(db, {
        id: definition.id,
        label: definition.label,
        required: definition.required,
        position,
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

  return { organizationId, typeId, statusIds, roleIds, priceBookItemIds };
}
