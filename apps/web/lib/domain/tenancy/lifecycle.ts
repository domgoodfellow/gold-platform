import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResources } from '@/lib/domain/resources/resources';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listEnabledModules, MODULES_WITH_READINESS_CHECK, outstandingModuleSetup } from './modules';
import { areaHref, areaLabel, MODULES, moduleConfiguration } from '@/lib/navigation';

/**
 * SETUP or LIVE. Nothing else, on purpose (see the migration this ships with) — suspension,
 * offboarding and paid entitlement are separate, later concerns, and folding any of them into
 * this column would invite billing state into a field that answers only "should Business Setup
 * be the loudest thing in the shell".
 */
export type OperationalState = 'setup' | 'live';

export type ReadinessRequirement = {
  /** The module this came from — a stable key for a list React can render without re-keying. */
  key: string;
  /** Application state, in the platform's own voice — never a tenant's word, never advice. */
  message: string;
  /** Where this is resolved. */
  area: { href: string; label: string };
};

export type Readiness = {
  blockers: ReadinessRequirement[];
  warnings: ReadinessRequirement[];
  optional: ReadinessRequirement[];
};

/**
 * Everything standing between this business and Launch — computed fresh on every call, never
 * stored. A persisted `ready` boolean would be exactly the second answer I4 and I5 already
 * refuse one level up, and it would go stale the instant a module was switched off again.
 *
 * **Deliberately not a general checklist.** No work item type, no transitions, no additional
 * member besides the owner, no price book, no operating hours, no resource, no location is ever
 * a requirement here on its own — a solo tenant with nothing configured yet is a valid business,
 * and no operating hours already means "always open" rather than "broken" (`settings/page.tsx`
 * says as much). Every requirement below is contributed by a module this business actually
 * switched on, reusing exactly the notes `outstandingModuleSetup` already computes for
 * Settings — extended with a link and a severity, never a second calculation of the same gaps.
 *
 * **Which notes count as a blocker is asked of the database, not decided here.**
 * `app.organization_launch_blockers` is the one definition — the same function
 * `launch_organization`'s own trigger enforces atomically — so this and the write path cannot
 * quietly drift into disagreeing about what stops a launch.
 */
export async function computeReadiness(
  db: Db,
  input: { organizationId: string },
): Promise<Readiness> {
  const enabled = await listEnabledModules(db, { organizationId: input.organizationId });
  const [outstanding, blocking] = await Promise.all([
    outstandingModuleSetup(db, { organizationId: input.organizationId, enabled }),
    launchBlockers(db, { organizationId: input.organizationId }),
  ]);

  const blockers: ReadinessRequirement[] = [];
  const warnings: ReadinessRequirement[] = [];

  for (const [key, message] of outstanding) {
    // Drafting is about producing this very setup, not a capability this business sells to
    // anyone — asking whether the tool that helped configure the business is itself finished is
    // circular, so it is never a requirement of the business it helped configure.
    if (key === 'drafting') continue;

    const sold = MODULES.find((entry) => entry.key === key);
    if (!sold) continue;

    const requirement: ReadinessRequirement = {
      key,
      message,
      area: moduleConfiguration(input.organizationId, sold),
    };

    if (blocking.has(key)) {
      blockers.push(requirement);
    } else {
      warnings.push(requirement);
    }
  }

  // Nothing populates this yet. A requirement invented to fill it would be exactly the "look
  // complete" mistake this function exists to refuse.
  return { blockers, warnings, optional: [] };
}

/**
 * One thing a business may set up, and whether it is done. Importance exists only while
 * something is outstanding — a finished area has no importance worth reporting.
 *
 * **Importance is never invented here.** `required` is exactly what the database names as a
 * launch blocker; `recommended` is a switched-on module with a note that does not block; `optional`
 * is kernel configuration (work, resources, locations), which `computeReadiness` documents as
 * never a requirement of a business on its own.
 */
export type SetupImportance = 'required' | 'recommended' | 'optional';

export type SetupArea = {
  key: string;
  label: string;
  /** Application state, in the platform's own voice. */
  message: string;
  /** The canonical surface that owns this configuration. */
  area: { href: string; label: string };
} & ({ state: 'complete' } | { state: 'incomplete'; importance: SetupImportance });

export type SetupOverview = {
  /** Required gaps first, then recommended, then optional, then everything finished. */
  areas: SetupArea[];
  blockers: SetupArea[];
  ready: number;
  total: number;
  recommendedOpen: number;
  optionalOpen: number;
};

const IMPORTANCE_ORDER: Record<string, number> = { required: 0, recommended: 1, optional: 2 };

/**
 * The setup cockpit's whole answer, built from `computeReadiness` (the module areas, and which of
 * them block) plus three plain facts about the kernel configuration a business has or has not
 * done. A count of areas, never a count of fields — 4 of 6 means four things are finished.
 *
 * Kernel areas are always optional: a solo tenant with none of them is a valid business, and
 * saying otherwise here would contradict `computeReadiness` and the database's own launch check.
 */
export async function computeSetupOverview(
  db: Db,
  input: { organizationId: string },
): Promise<SetupOverview> {
  const { organizationId } = input;
  const [readiness, enabled, types, resources, locations] = await Promise.all([
    computeReadiness(db, { organizationId }),
    listEnabledModules(db, { organizationId }),
    listWorkItemTypes(db, { organizationId }),
    listResources(db, { organizationId, limit: 1 }),
    listLocations(db, { organizationId, limit: 1 }),
  ]);

  const moduleArea = (item: ReadinessRequirement, importance: SetupImportance): SetupArea => ({
    key: item.key,
    label: MODULES.find((entry) => entry.key === item.key)?.label ?? item.key,
    message: item.message,
    area: item.area,
    state: 'incomplete',
    importance,
  });

  const areas: SetupArea[] = [
    ...readiness.blockers.map((item) => moduleArea(item, 'required')),
    ...readiness.warnings.map((item) => moduleArea(item, 'recommended')),
  ];

  // A checked module with nothing outstanding is finished, and worth saying so.
  const open = new Set(areas.map((entry) => entry.key));
  for (const sold of MODULES) {
    if (!enabled.has(sold.key) || open.has(sold.key) || !MODULES_WITH_READINESS_CHECK.has(sold.key)) continue;
    areas.push({
      key: sold.key,
      label: sold.label,
      message: 'Nothing outstanding.',
      area: moduleConfiguration(organizationId, sold),
      state: 'complete',
    });
  }

  const kernel = (
    key: string,
    segment: string,
    href: string,
    count: number,
    done: string,
    missing: string,
  ): SetupArea => ({
    key,
    label: areaLabel(segment),
    message: count > 0 ? done : missing,
    area: { href, label: areaLabel(segment) },
    ...(count > 0
      ? { state: 'complete' as const }
      : { state: 'incomplete' as const, importance: 'optional' as const }),
  });

  areas.push(
    kernel(
      'work',
      'work',
      `${areaHref(organizationId, 'work')}/configuration`,
      types.length,
      types.length === 1 ? '1 kind of work is defined.' : `${types.length} kinds of work are defined.`,
      'No kinds of work are defined.',
    ),
    kernel(
      'resources',
      'resources',
      areaHref(organizationId, 'resources'),
      resources.total,
      'Resources exist to assign to a job.',
      'No resources exist, so nothing can be assigned to a job.',
    ),
    kernel(
      'locations',
      'locations',
      areaHref(organizationId, 'locations'),
      locations.total,
      'Locations exist to attach to a job.',
      'No locations exist.',
    ),
  );

  areas.sort((a, b) => {
    const rank = (entry: SetupArea) =>
      entry.state === 'complete' ? 3 : IMPORTANCE_ORDER[entry.importance];
    return rank(a) - rank(b);
  });

  const count = (importance: SetupImportance) =>
    areas.filter((entry) => entry.state === 'incomplete' && entry.importance === importance).length;

  return {
    areas,
    blockers: areas.filter((entry) => entry.state === 'incomplete' && entry.importance === 'required'),
    ready: areas.filter((entry) => entry.state === 'complete').length,
    total: areas.length,
    recommendedOpen: count('recommended'),
    optionalOpen: count('optional'),
  };
}

/** The database's own answer to which module keys currently block a launch. */
async function launchBlockers(
  db: Db,
  input: { organizationId: string },
): Promise<ReadonlySet<string>> {
  const { data, error } = await db.rpc('organization_launch_blockers', {
    p_id: input.organizationId,
  });

  if (error) {
    throw new DomainError(error.message, 'organizations.readiness_failed');
  }

  return new Set(data ?? []);
}

/**
 * The one deliberate action that moves a business from Setup to Live.
 *
 * Readiness is re-checked here, immediately before the write, for a fast and complete message —
 * blockers and warnings both, with links. **That check is a courtesy, not the guarantee.** The
 * guarantee is `organizations_check_launch_readiness`, a trigger on `operational_state` itself
 * that asks the same `app.organization_launch_blockers` this function's readiness check just
 * asked, atomically, inside the transition — so a caller who skips this function and invokes
 * `launch_organization` directly is refused by the database regardless, not merely by whichever
 * TypeScript happened to be in front of it (I12: hiding a control, or in this case a call, was
 * never the authorization).
 */
export async function launchOrganization(
  db: Db,
  input: { organizationId: string },
): Promise<void> {
  await requireActor(db);

  const readiness = await computeReadiness(db, { organizationId: input.organizationId });
  if (readiness.blockers.length > 0) {
    throw new DomainError(
      'This business has something switched on and not working yet. Launch is refused until every blocker below clears.',
      'organizations.not_ready',
    );
  }

  const { error } = await db.rpc('launch_organization', { p_id: input.organizationId });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Your role cannot launch this business.', 'organizations.launch_forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError('This business is already live.', 'organizations.already_live');
    }
    // The trigger's own refusal — reached only if a blocker appeared between the check above
    // and this call, since the ordinary path never gets here with one still standing.
    if (error.code === '55000') {
      throw new DomainError(
        'This business has something switched on and not working yet. Launch is refused until every blocker clears.',
        'organizations.not_ready',
      );
    }
    throw new DomainError(error.message, 'organizations.launch_failed');
  }
}
