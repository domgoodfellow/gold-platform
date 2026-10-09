import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResources } from '@/lib/domain/resources/resources';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import { isEligible, listResourceRequirements, requirementTitle } from '@/lib/domain/work-items/requirements';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import {
  describeServiceAccess,
  getOrganizationServiceAccess,
} from '@/lib/domain/platform-billing/service-access';
import { MODULES_WITH_READINESS_CHECK } from './modules';
import { activeModuleKeys, readinessModuleKey, organizationResolvedFeatureStates, type ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
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
  /** For a requirement that is not a module, which has no catalogue label to read. */
  label?: string;
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
 * `organization_launch_blockers` is the one definition — the door over the same function
 * `launch_organization`'s own trigger enforces atomically — so this and the write path cannot
 * quietly drift into disagreeing about what stops a launch.
 */
export async function computeReadiness(
  db: Db,
  input: { organizationId: string },
  resolved?: ResolvedFeatureState[],
): Promise<Readiness> {
  const states = resolved ?? await organizationResolvedFeatureStates(db, input);
  const outstanding = new Map(states.filter((state) => state.moduleKey && state.readiness === 'setup_required')
    .map((state) => [state.moduleKey!, state.reason ?? 'Configuration is required.']));
  const [blocking, serviceIfLive] = await Promise.all([
    launchBlockers(db, { organizationId: input.organizationId }),
    // The one service-access resolver, asked the question Launch is: would this business be
    // permitted once it is live? Setup's own leniency (`subscription_pending_setup`) ends there.
    getOrganizationServiceAccess(db, {
      organizationId: input.organizationId,
      environment: platformBillingEnvironment(),
      operationalState: 'live',
    }),
  ]);

  const blockers: ReadinessRequirement[] = [];
  const warnings: ReadinessRequirement[] = [];

  // Payment is mandatory at Launch (`service-access.ts`). Derived, never stored; and distinct from
  // the module blockers below, which are the database's answer — the database does not know which
  // billing environment this deployment bills in, so it cannot ask this one.
  if (!serviceIfLive.permitted) {
    blockers.push({
      key: 'subscription',
      label: 'Subscription',
      message: `${describeServiceAccess(serviceIfLive)} Start the subscription before launching.`,
      area: { href: `/organizations/${input.organizationId}/settings/plan`, label: 'Plan & usage' },
    });
  }

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
  resolved?: ResolvedFeatureState[],
): Promise<SetupOverview> {
  const { organizationId } = input;
  const states = resolved ?? await organizationResolvedFeatureStates(db, input);
  const [readiness, enabled, types] = await Promise.all([
    computeReadiness(db, { organizationId }, states),
    Promise.resolve(activeModuleKeys(states.filter((state) => readinessModuleKey(state) !== null))),
    listWorkItemTypes(db, { organizationId }),
  ]);
  // The declaration, read from the types already loaded — the same fact `hasSchedulableWork`
  // answers for navigation, so setup cannot ask for resources the sidebar has withheld.
  const schedulesWork = types.some((type) => type.schedulable);
  const [resources, locations, hours, requirements, everyResource] = schedulesWork
    ? await Promise.all([
        listResources(db, { organizationId, limit: 1 }),
        listLocations(db, { organizationId, limit: 1 }),
        listOperatingHours(db, { organizationId }),
        listResourceRequirements(db, { organizationId }),
        listResources(db, { organizationId, limit: 1000 }),
      ])
    : [null, null, null, null, null];

  const moduleArea = (item: ReadinessRequirement, importance: SetupImportance): SetupArea => ({
    key: item.key,
    label: item.label ?? MODULES.find((entry) => entry.key === item.key)?.label ?? item.key,
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
  );

  // Resources, hours and locations only describe scheduled work. A business whose work is not
  // scheduled is not asked for them — and a scheduling business with none of them yet is asked,
  // gently, because zero is a valid count and not a reason to hide the question.
  if (resources && locations && hours) {
    areas.push(
      kernel(
        'resources',
        'resources',
        areaHref(organizationId, 'resources'),
        resources.total,
        'Resources exist to assign to a job.',
        'No resources exist, so nothing can be assigned to a job.',
      ),
      {
        ...kernel(
          'hours',
          'schedule',
          `${areaHref(organizationId, 'schedule')}/configuration`,
          hours.length,
          'Opening hours are set.',
          'No opening hours are set, so this business is treated as always open.',
        ),
        label: 'Opening hours',
      },
      ...(requirements && requirements.length > 0 && everyResource
        ? [capacityArea(organizationId, types, requirements, everyResource)]
        : []),
      kernel(
        'locations',
        'locations',
        areaHref(organizationId, 'locations'),
        locations.total,
        'Locations exist to attach to a job.',
        'No locations exist.',
      ),
    );
  }

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

/**
 * Does the business have enough resources of the kinds its work says it needs? A plain count of who
 * is eligible against how many are required — **not** availability: nobody's calendar is read, and
 * a resource off on holiday still counts. A requirement that is well formed is not invalid for
 * being short of resources; it is setup still to do, so this is optional and never a blocker.
 */
function capacityArea(
  organizationId: string,
  types: { id: string; name: string }[],
  requirements: Awaited<ReturnType<typeof listResourceRequirements>>,
  resources: Awaited<ReturnType<typeof listResources>>,
): SetupArea {
  const typeName = new Map(types.map((type) => [type.id, type.name]));
  const short = requirements.flatMap((requirement) => {
    const eligible = resources.filter((resource) => isEligible(resource, requirement)).length;
    return eligible >= requirement.quantity
      ? []
      : [`${typeName.get(requirement.typeId) ?? 'A kind of work'} needs ${requirement.quantity} × ${requirementTitle(requirement, RESOURCE_CLASS_LABELS)}; ${eligible} ${eligible === 1 ? 'exists' : 'exist'}.`];
  });

  const base = {
    key: 'resource-capacity',
    label: 'Resources for scheduled work',
    area: { href: areaHref(organizationId, 'resources'), label: areaLabel('resources') },
  };
  return short.length === 0
    ? { ...base, message: 'Enough resources exist for what each kind of work needs.', state: 'complete' as const }
    : { ...base, message: short.join(' '), state: 'incomplete' as const, importance: 'optional' as const };
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
 * that asks `app.organization_launch_blockers_unchecked`, the same answer this function's readiness check just
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
      throw new DomainError('Your role cannot finish setup for this business.', 'organizations.launch_forbidden');
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
