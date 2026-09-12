import { DividedList, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import type { AutomationRun } from '@/lib/domain/automation/rules';

/**
 * What the rules have done, across every rule at once — the page-level counterpart to the
 * shorter "Recently" list each `AutomationRuleCard` shows for its own rule. Newest first, and
 * naming which rule ran, since that is the one thing a per-rule list does not need to say.
 */
export function RunLog({ runs }: { runs: AutomationRun[] }) {
  if (runs.length === 0) return null;

  return (
    <Section className="mt-10">
      <SectionHeading>What the rules have done</SectionHeading>
      <Hint className="mt-1">
        Newest first. A rule that did not apply records nothing — what is here is what happened.
      </Hint>
      <DividedList className="mt-2">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
            <span className="text-subtle">
              {new Date(run.occurredAt).toLocaleString('en-GB')}
            </span>
            <span className="font-medium">{run.ruleName}</span>
            {run.outcome === 'failed' ? (
              <span className="text-danger">failed — {run.detail}</span>
            ) : (
              <span className="text-muted">ran</span>
            )}
          </li>
        ))}
      </DividedList>
    </Section>
  );
}
