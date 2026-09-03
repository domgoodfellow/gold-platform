import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import {
  GROUPINGS,
  PERIODS,
  listInvoicedAndIncurred,
  periodFor,
  type FinancialGroup,
  type Filters,
  type Grouping,
  type PeriodPreset,
} from '@/lib/domain/reporting/financials';

/**
 * A report a business saved, and running one.
 *
 * **A definition holds arguments, never a query and never a figure** (D36). What it saves is
 * exactly what the Reports screen was showing: a grouping, a period, and up to three filters.
 * There is no builder here because for this report set there is nothing left to build — the
 * entity *is* the grouping, the fields are invoiced, incurred and margin, and the calculation
 * is the subtraction `invoiced_and_incurred` owns.
 *
 * **Running one calls the same aggregate the ad-hoc screen calls.** That is D35's rule one
 * level up and the thing most likely to be undone by a well-meaning optimisation: a saved
 * report that grew its own query would be a second answer to a question that already has one.
 * `reporting.test.ts` asserts that a saved report and the ad-hoc view return identical rows.
 *
 * **Who may see one is a policy and never a filter here.** `report_definitions_select` returns
 * no row for a report shared with a role the caller does not hold, so a listing narrowed in
 * this file would be a second, weaker copy of that rule. Nothing below filters by audience.
 */

export type ReportDefinition = {
  id: string;
  /** The business's own word for it. The platform ships none. */
  name: string;
  grouping: Grouping;
  period: PeriodPreset;
  filters: Filters;
  createdAt: string;
};

const NAME_MAX = 120;

function cleanName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new DomainError('A report needs a name.', 'reports.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `A report's name is at most ${NAME_MAX} characters.`,
      'reports.name_too_long',
    );
  }
  return name;
}

function rowToDefinition(row: {
  id: string;
  name: string;
  grouping: string;
  period: string;
  customer_id: string | null;
  resource_id: string | null;
  location_id: string | null;
  created_at: string;
}): ReportDefinition {
  return {
    id: row.id,
    name: row.name,
    grouping: row.grouping as Grouping,
    period: row.period as PeriodPreset,
    filters: {
      customerId: row.customer_id,
      resourceId: row.resource_id,
      locationId: row.location_id,
    },
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, name, grouping, period, customer_id, resource_id, location_id, created_at';

export async function listReportDefinitions(
  db: Db,
  input: { organizationId: string },
): Promise<ReportDefinition[]> {
  const { data, error } = await db
    .from('report_definitions')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'reports.list_failed');
  }

  return (data ?? []).map(rowToDefinition);
}

export async function getReportDefinition(
  db: Db,
  input: { organizationId: string; id: string },
): Promise<ReportDefinition | null> {
  const { data, error } = await db
    .from('report_definitions')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.id)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'reports.read_failed');
  }

  // Null covers "no such report" and "not shared with your role" indistinguishably, because the
  // policy simply does not return the row. That is the same absence `getOrganization` relies on,
  // and telling the two apart would be the disclosure the audience exists to prevent.
  return data ? rowToDefinition(data) : null;
}

export async function saveReportDefinition(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    grouping: Grouping;
    period: PeriodPreset;
    filters?: Filters;
  },
): Promise<string> {
  await requireActor(db);

  // Re-checked here to produce a sentence, exactly as `changeWorkItemStatus` re-checks a
  // transition the trigger already guarantees. The check constraint is the guarantee.
  if (!GROUPINGS.includes(input.grouping)) {
    throw new DomainError('That is not a grouping this platform reports on.', 'reports.grouping');
  }
  if (!PERIODS.includes(input.period)) {
    throw new DomainError('That is not a period this platform reports on.', 'reports.period');
  }

  const { data: user } = await db.auth.getUser();

  const { data, error } = await db
    .from('report_definitions')
    .insert({
      organization_id: input.organizationId,
      name: cleanName(input.name),
      grouping: input.grouping,
      period: input.period,
      customer_id: input.filters?.customerId ?? null,
      resource_id: input.filters?.resourceId ?? null,
      location_id: input.filters?.locationId ?? null,
      created_by: user.user!.id,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `You already have a report called ${input.name.trim()}.`,
        'reports.name_taken',
      );
    }
    throw new DomainError(error.message, 'reports.save_failed');
  }

  return data.id;
}

export async function renameReportDefinition(
  db: Db,
  input: { id: string; name: string },
): Promise<void> {
  await requireActor(db);

  const { error } = await db
    .from('report_definitions')
    .update({ name: cleanName(input.name) })
    .eq('id', input.id);

  if (error) {
    throw new DomainError(error.message, 'reports.rename_failed');
  }
}

export async function deleteReportDefinition(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db.from('report_definitions').delete().eq('id', input.id);

  if (error) {
    throw new DomainError(error.message, 'reports.delete_failed');
  }
}

/** Which roles a report is for. Empty means nobody but its author and whoever manages reports. */
export async function listReportRoles(
  db: Db,
  input: { organizationId: string; reportId: string },
): Promise<string[]> {
  const { data, error } = await db
    .from('report_definition_roles')
    .select('role_id')
    .eq('organization_id', input.organizationId)
    .eq('report_id', input.reportId);

  if (error) {
    throw new DomainError(error.message, 'reports.roles_failed');
  }

  return (data ?? []).map((row) => row.role_id);
}

/**
 * Say who a report is for, replacing whatever it said before.
 *
 * Delete-then-insert rather than a diff, because the audience is a set and a set is what the
 * screen edits. **Not atomic**, and that is the same honest limitation `configureBusiness`
 * carries: a failure part-way leaves a report shared with fewer roles than intended, which is a
 * state the screen already renders — it is what a half-configured share looks like — and
 * narrowing an audience is the safe direction for a partial failure to land in.
 */
export async function setReportRoles(
  db: Db,
  input: { organizationId: string; reportId: string; roleIds: string[] },
): Promise<void> {
  await requireActor(db);
  const { data: user } = await db.auth.getUser();

  // **A delete RLS filters to nothing is not an error, and that was found by a test.** Clearing
  // an audience you may not manage removed no rows and came back clean, so this function
  // reported success for a write it had not performed — harmless, because nothing changed, and
  // misleading on a screen that then redraws the boxes exactly as they were.
  //
  // The check is against the database's own answer rather than against a capability read in
  // TypeScript, which would be the authorization-in-the-wrong-place this platform refuses:
  // `report_definition_roles_select` lets any member of the business see these rows, so rows
  // that were there and did not go is a fact this caller can establish, and the policy is still
  // the thing that refused.
  const before = await listReportRoles(db, input);

  const { data: removed, error: cleared } = await db
    .from('report_definition_roles')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('report_id', input.reportId)
    .select('id');

  if (cleared) {
    throw new DomainError(cleared.message, 'reports.share_failed');
  }

  if (before.length > 0 && (removed ?? []).length === 0) {
    throw new DomainError(
      'You may not choose who sees this report.',
      'reports.share_failed',
    );
  }

  if (input.roleIds.length === 0) {
    // Nothing to add, and nothing was there to remove either — so there is no write this
    // caller could have been refused, and reporting success is the truthful answer.
    return;
  }

  const { error } = await db.from('report_definition_roles').insert(
    input.roleIds.map((roleId) => ({
      organization_id: input.organizationId,
      report_id: input.reportId,
      role_id: roleId,
      created_by: user.user!.id,
    })),
  );

  if (error) {
    throw new DomainError(error.message, 'reports.share_failed');
  }
}

/**
 * The figures a saved report stands for.
 *
 * **It calls the one aggregate with what the row stored, and does nothing else** (D35, D36).
 * There is no second query here and there must never be one: a saved report is arguments, and
 * the answer to those arguments already has exactly one source.
 */
export async function runReportDefinition(
  db: Db,
  input: { organizationId: string; definition: ReportDefinition; today: string },
): Promise<FinancialGroup[]> {
  return listInvoicedAndIncurred(db, {
    organizationId: input.organizationId,
    grouping: input.definition.grouping,
    period: periodFor(input.definition.period, input.today),
    filters: input.definition.filters,
  });
}
