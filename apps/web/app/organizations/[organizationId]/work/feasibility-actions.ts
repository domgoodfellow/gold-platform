'use server';

import { viewFeasibility, type FeasibilityView } from '@/features/scheduling/feasibility-text';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { listResources } from '@/lib/domain/resources/resources';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import { assessInterval } from '@/lib/domain/scheduling/feasibility';
import { localDateTimeToInstant } from '@/lib/domain/scheduling/window';
import { listResourceRequirements, requirementTitle } from '@/lib/domain/work-items/requirements';
import { getWorkItem } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';

export type FeasibilityState = { error: string | null; view?: FeasibilityView };

/**
 * *Would this time work?* — asked while somebody is choosing it, instead of after they press
 * Schedule. A read: it writes nothing and records nothing, and it is advisory (I6) — the schedule
 * command still decides, in its own transaction, whatever this said a moment earlier.
 *
 * The times are typed as the business reads the clock, so they are converted in the business's zone.
 * The ticked resources are judged as an exact set; the suggestion is judged separately and prefers
 * them when they still work.
 */
export async function checkFeasibilityAction(
  _previous: FeasibilityState,
  formData: FormData,
): Promise<FeasibilityState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');
  const { organization } = await requireOrganization(organizationId);

  try {
    const startsAt = localDateTimeToInstant(String(formData.get('startsAt') ?? ''), organization.timezone);
    const endsAt = localDateTimeToInstant(String(formData.get('endsAt') ?? ''), organization.timezone);
    if (!formData.get('startsAt') || !formData.get('endsAt')) {
      throw new DomainError('Give a start and an end to check.', 'feasibility.window_required');
    }

    const workItem = await getWorkItem(db, { organizationId, workItemId });
    if (!workItem) throw new DomainError('No such job here.', 'feasibility.not_found');

    const chosen = formData.getAll('resourceIds').map(String).filter(Boolean);
    const [{ feasibility, selection }, requirements, resources] = await Promise.all([
      assessInterval(db, {
        organizationId,
        workTypeId: workItem.type.id,
        timeZone: organization.timezone,
        start: startsAt,
        end: endsAt,
        excludeWorkItemId: workItemId,
        resourceIds: chosen,
      }),
      listResourceRequirements(db, { organizationId, typeId: workItem.type.id }),
      listResources(db, { organizationId, limit: 1000 }),
    ]);

    const resourceName = new Map(resources.map((resource) => [resource.id, resource.name]));
    const titles = new Map(requirements.map((requirement) => [requirement.id, requirementTitle(requirement, RESOURCE_CLASS_LABELS)]));

    return {
      error: null,
      view: viewFeasibility(feasibility, selection, {
        resource: (id) => resourceName.get(id) ?? 'A resource',
        requirement: (id) => (id ? (titles.get(id) ?? 'A resource') : 'A resource'),
      }),
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
