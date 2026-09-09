import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { listEnabledModules, outstandingModuleSetup } from './modules';
import { MODULES, moduleConfiguration } from '@/lib/navigation';

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
