import type { TriggerKind } from '@/lib/domain/automation/rules';

/**
 * What a trigger kind needs or limits, said once and shown wherever that trigger is chosen or
 * read: on the new-workflow page while it is being chosen, and in the workbench afterwards.
 * Each is a consequence a person acts on, never a description of the feature.
 */
export const TRIGGER_NOTES: Partial<Record<TriggerKind, string>> = {
  schedule: 'Runs once per scheduled job, counted from when the job starts.',
  external_reading: 'Needs incoming readings in exactly this unit.',
  counter_threshold: 'Needs machine readings in this unit. The only action for a machine is Raise a job.',
};
