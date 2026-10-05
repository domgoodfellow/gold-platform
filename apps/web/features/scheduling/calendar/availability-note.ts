import type { AvailabilityProblem } from '@/lib/domain/scheduling/resource-availability';

/** The one sentence for scheduled work that no longer fits a resource, in Day and Week alike. */
export function availabilityNote(problem: AvailabilityProblem | null, resourceName: string): string | undefined {
  if (problem === 'outside_hours') return `Outside ${resourceName}’s working hours`;
  if (problem === 'unavailable') return `${resourceName} is unavailable`;
  return undefined;
}
