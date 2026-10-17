import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { AllowanceType, OverageBehavior, OveragePolicy, QuotaPeriod } from '@/lib/domain/catalogue/plans';

/**
 * What an organization is allowed to consume right now, and whether it may consume more.
 *
 * **One answer, not a second calculation.** Both functions here are thin readers over
 * `app.allowance_states` and `app.allowance_decision` — the one place composition, the window and
 * consumption are worked out (the one-calculation rule and the single availability model's rule, applied to allowances). Nothing in this file adds,
 * subtracts or compares a quantity, because the moment it did there would be two answers to "how
 * much is left" and the one a screen shows would be the one nothing enforces.
 *
 * The calculation lives in SQL because the decision and the usage write are one commercial
 * operation: `app.record_usage` takes a lock over the same allowance and splits the quantity in
 * the same transaction, so two concurrent operations cannot both spend the last included unit. An
 * enforcement point a screen could reach but `open_call`, an automation or a provider callback
 * could not would be a disabled button, which is exactly what the messaging rules' credit gate already refused
 * to be.
 *
 * Nothing here reads a provider cost, a provider key or a margin: `organization_allowance_state`
 * selects the quantity side only, so a tenant screen and a staff screen can both call it.
 */

export type AllowanceWindowBasis = 'subscription' | 'assignment' | 'calendar' | 'none' | 'unknown';

/** How consumption was established — and whether it was established at all. */
export type AllowanceEnforcement =
  /** Counted from `usage_events`, the one usage ledger. */
  | 'metered'
  /** Counted from a real resource model named in `platform_allowance_counters`. */
  | 'counted'
  /** Nothing counts this allowance yet. `consumed` and `remaining` are null, never zero. */
  | 'unenforced'
  /** No allowance governs the thing asked about; reported by a decision, never by a state. */
  | 'ungoverned';

export type AllowanceState = 'available' | 'soft_limit' | 'hard_limit' | 'configuration_error';

/** One Plan's or Add-on's part of a resolved allowance — the raw provenance, kept through resolution. */
export type AllowanceContribution = {
  planId: string;
  planKey: string;
  planLabel: string;
  planKind: 'plan' | 'addon';
  /** The Plan's own quota row, before any organization override. */
  planDefault: number;
  /** This organization's override, or null if it has none for this Plan and allowance. */
  override: number | null;
  effective: number;
  hardLimit: number | null;
  overridden: boolean;
  allowanceType: AllowanceType;
  unit: string;
  period: QuotaPeriod;
  resetSemantics: 'billing_period' | 'calendar_period' | 'none';
  overageBehavior: OverageBehavior;
  meterId: string | null;
  serviceClass: string | null;
};

export type OrganizationAllowanceState = {
  allowanceKey: string;
  label: string;
  unit: string;
  type: AllowanceType;
  period: QuotaPeriod;
  window: {
    startsAt: string | null;
    endsAt: string | null;
    resetSemantics: 'billing_period' | 'calendar_period' | 'none';
    /**
     * Which fact decided the window: the processor's own subscription period, the Plan
     * assignment's anchor, the organization's calendar, or no window at all. A caller showing a
     * reset date says which — it must never present an anchored period as a processor-backed one.
     */
    basis: AllowanceWindowBasis;
  };
  /** Null only when contributing Plans disagree, which is `state: 'configuration_error'`. */
  included: number | null;
  /** Null when nothing counts this allowance (`enforcement: 'unenforced'`) — not zero. */
  consumed: number | null;
  /** No reservation model exists: concurrency is handled by a lock, not by holding units aside. */
  reserved: number;
  /** Signed: negative once consumption has passed what is included. Null where `consumed` is. */
  remaining: number | null;
  /** How far past the included quantity consumption has gone, never negative. */
  overageQuantity: number;
  hardLimit: number | null;
  overagePolicy: OveragePolicy;
  overageBehavior: OverageBehavior;
  meterId: string | null;
  serviceClass: string | null;
  sourceContributions: AllowanceContribution[];
  enforcement: AllowanceEnforcement;
  state: AllowanceState;
  /** What the contributing Plans disagree about. Null unless `state: 'configuration_error'`. */
  configurationError: string | null;
};

type StateRow = {
  allowance_key: string;
  label: string;
  unit: string;
  allowance_type: string;
  period: string;
  reset_semantics: string;
  window_starts_at: string | null;
  window_ends_at: string | null;
  window_basis: string;
  included: string | number | null;
  consumed: string | number | null;
  reserved: string | number;
  remaining: string | number | null;
  overage_quantity: string | number;
  hard_limit: string | number | null;
  overage_policy: string;
  overage_behavior: string;
  meter_id: string | null;
  service_class: string | null;
  contributions: unknown;
  enforcement: string;
  state: string;
  configuration_error: string | null;
};

const num = (value: string | number | null): number | null => (value === null ? null : Number(value));

function toState(row: StateRow): OrganizationAllowanceState {
  return {
    allowanceKey: row.allowance_key,
    label: row.label,
    unit: row.unit,
    type: row.allowance_type as AllowanceType,
    period: row.period as QuotaPeriod,
    window: {
      startsAt: row.window_starts_at,
      endsAt: row.window_ends_at,
      resetSemantics: row.reset_semantics as OrganizationAllowanceState['window']['resetSemantics'],
      basis: row.window_basis as AllowanceWindowBasis,
    },
    included: num(row.included),
    consumed: num(row.consumed),
    reserved: Number(row.reserved),
    remaining: num(row.remaining),
    overageQuantity: Number(row.overage_quantity),
    hardLimit: num(row.hard_limit),
    overagePolicy: row.overage_policy as OveragePolicy,
    overageBehavior: row.overage_behavior as OverageBehavior,
    meterId: row.meter_id,
    serviceClass: row.service_class,
    sourceContributions: (Array.isArray(row.contributions) ? row.contributions : []).map(
      (entry): AllowanceContribution => {
        const c = entry as Record<string, unknown>;
        return {
          planId: String(c.planId ?? ''),
          planKey: String(c.planKey ?? ''),
          planLabel: String(c.planLabel ?? ''),
          planKind: (c.planKind === 'addon' ? 'addon' : 'plan') as 'plan' | 'addon',
          planDefault: Number(c.planDefault ?? 0),
          override: c.override === null || c.override === undefined ? null : Number(c.override),
          effective: Number(c.effective ?? 0),
          hardLimit: c.hardLimit === null || c.hardLimit === undefined ? null : Number(c.hardLimit),
          overridden: Boolean(c.overridden),
          allowanceType: c.allowanceType as AllowanceType,
          unit: String(c.unit ?? ''),
          period: c.period as QuotaPeriod,
          resetSemantics: c.resetSemantics as AllowanceContribution['resetSemantics'],
          overageBehavior: c.overageBehavior as OverageBehavior,
          meterId: (c.meterId as string | null) ?? null,
          serviceClass: (c.serviceClass as string | null) ?? null,
        };
      },
    ),
    enforcement: row.enforcement as AllowanceEnforcement,
    state: row.state as AllowanceState,
    configurationError: row.configuration_error,
  };
}

/**
 * Every allowance this organization currently has, resolved. A member reads its own business's;
 * platform staff read any — the function proves which itself rather than trusting the caller
 *, so there is nothing here for a page to filter.
 *
 * Empty for an organization with no Plan assignment: it has no allowances, which is a different
 * answer from having allowances of nothing.
 */
export async function organizationAllowanceStates(
  db: Db,
  input: { organizationId: string; allowanceKey?: string; at?: string },
): Promise<OrganizationAllowanceState[]> {
  const { data, error } = await db.rpc('organization_allowance_state', {
    p_organization_id: input.organizationId,
    p_allowance_key: input.allowanceKey ?? undefined,
    p_at: input.at ?? undefined,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot read this business’s allowances.', 'allowances.forbidden');
    }
    throw new DomainError(error.message, 'allowances.states_failed');
  }

  return ((data ?? []) as unknown as StateRow[]).map(toState);
}

export type AllowanceDecisionResult =
  | 'allowed'
  | 'allowed_with_overage'
  | 'soft_limit_warning'
  | 'hard_limit_reached'
  | 'not_entitled'
  | 'configuration_error';

export type AllowanceDecision = {
  result: AllowanceDecisionResult;
  /**
   * Whether the operation may proceed. Carried rather than derived from `result`, so no caller
   * has to remember that a soft limit warns and a configuration error permits.
   */
  permitted: boolean;
  /** False when no allowance in this package governs the thing asked about. */
  governed: boolean;
  allowanceKey: string | null;
  label: string | null;
  unit: string | null;
  included: number | null;
  consumed: number | null;
  remaining: number | null;
  /** Of the requested quantity: how much the allowance covers, and how much is chargeable. */
  includedApplied: number | null;
  overageApplied: number | null;
  hardLimit: number | null;
  overageBehavior: OverageBehavior | null;
  enforcement: AllowanceEnforcement;
  window: { startsAt: string | null; endsAt: string | null; basis: AllowanceWindowBasis | null };
  /** Why, in a sentence a person can act on. Null when there is nothing to explain. */
  detail: string | null;
};

/**
 * Whether this organization may consume this much of one allowance right now.
 *
 * The one API a runtime consumer asks, so that `if (used >= limit)` is never written in
 * Communications, AI, Automations or Field. Enforcement at a mutation boundary calls the SQL
 * function directly (`app.spend_decision`, inside `open_call`); this is the read a screen uses to
 * explain the answer before anybody presses anything.
 */
export async function allowanceDecision(
  db: Db,
  input: { organizationId: string; allowanceKey: string; quantity?: number; at?: string },
): Promise<AllowanceDecision> {
  const { data, error } = await db.rpc('allowance_decision', {
    p_organization_id: input.organizationId,
    p_allowance_key: input.allowanceKey,
    p_requested_quantity: input.quantity ?? 1,
    p_at: input.at ?? undefined,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot read this business’s allowances.', 'allowances.forbidden');
    }
    throw new DomainError(error.message, 'allowances.decision_failed');
  }

  const row = ((data ?? []) as unknown as Record<string, string | number | boolean | null>[])[0];
  if (!row) throw new DomainError('No allowance decision was returned.', 'allowances.decision_failed');

  return {
    result: row.result as AllowanceDecisionResult,
    permitted: Boolean(row.permitted),
    governed: Boolean(row.governed),
    allowanceKey: (row.allowance_key as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    included: num(row.included as string | number | null),
    consumed: num(row.consumed as string | number | null),
    remaining: num(row.remaining as string | number | null),
    includedApplied: num(row.included_applied as string | number | null),
    overageApplied: num(row.overage_applied as string | number | null),
    hardLimit: num(row.hard_limit as string | number | null),
    overageBehavior: (row.overage_behavior as OverageBehavior | null) ?? null,
    enforcement: row.enforcement as AllowanceEnforcement,
    window: {
      startsAt: (row.window_starts_at as string | null) ?? null,
      endsAt: (row.window_ends_at as string | null) ?? null,
      basis: (row.window_basis as AllowanceWindowBasis | null) ?? null,
    },
    detail: (row.detail as string | null) ?? null,
  };
}

/**
 * When the allowance next resets, as a date a person can be told — or null when there is nothing
 * honest to say. A window with no end has no reset date, and a basis of `unknown` means the
 * boundary could not be established: both answer null rather than a fabricated date.
 */
export function allowanceResetsAt(state: OrganizationAllowanceState): string | null {
  if (state.window.basis === 'none' || state.window.basis === 'unknown') return null;
  return state.window.endsAt;
}
