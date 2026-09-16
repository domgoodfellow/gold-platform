import { DividedList, GroupHeading } from '@/components/containers/section';
import { EmptyState } from '@/components/containers/section';
import type { AutomationRun } from '@/lib/domain/automation/rules';

/**
 * A rule's own recent runs — scoped to this rule alone, unlike the workspace's combined Activity
 * view. `runs` is expected already filtered and limited by the caller (`listAutomationRuns` with
 * `ruleId`), so this renders rather than reads.
 */
export function RuleActivity({ runs }: { runs: AutomationRun[] }) {
  return (
    <section>
      <GroupHeading>Recent activity</GroupHeading>
      {runs.length === 0 ? (
        <EmptyState className="mt-1">Nothing has run yet.</EmptyState>
      ) : (
        <DividedList className="mt-1 text-sm">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
              <span className="text-subtle">{new Date(run.occurredAt).toLocaleString('en-GB')}</span>
              {run.outcome === 'failed' ? (
                <span className="text-danger">failed — {run.detail}</span>
              ) : (
                <span className="text-muted">ran</span>
              )}
            </li>
          ))}
        </DividedList>
      )}
    </section>
  );
}
