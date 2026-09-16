import Link from 'next/link';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Hint } from '@/components/controls/inputs';
import type { AutomationRule } from '@/lib/domain/automation/rules';
import type { RuleWarning } from '@/lib/domain/automation/review';
import { describeTrigger } from './trigger';
import { RuleEnabledToggle } from './rule-enabled-toggle';
import { NewAutomationSheet } from './new-automation-sheet';

/**
 * The Rules collection — a compact table rather than one fully-open `AutomationRuleCard` per
 * rule, which is what stopped this screen scaling past a handful. A rule is a complex entity and
 * gets its own detail route; this lists what somebody scanning the whole set needs to see before
 * deciding which one to open.
 */
export function RulesTable({
  organizationId,
  rules,
  warnings,
  mayManage,
}: {
  organizationId: string;
  rules: AutomationRule[];
  warnings: RuleWarning[];
  mayManage: boolean;
}) {
  const warningsByRule = new Map<string, string[]>();
  for (const warning of warnings) {
    warningsByRule.set(warning.ruleId, [...(warningsByRule.get(warning.ruleId) ?? []), warning.message]);
  }

  return (
    <div className="mt-4">
      <DataTable
        rows={rules}
        rowKey={(rule) => rule.id}
        empty="No rules yet. Nothing happens on its own until this business says it should."
        emptyAction={mayManage ? <NewAutomationSheet organizationId={organizationId} /> : undefined}
        columns={[
          {
            key: 'name',
            header: 'Name',
            emphasis: 'primary',
            cell: (rule) => (
              <Link
                href={`/organizations/${organizationId}/automations/${rule.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {rule.name}
              </Link>
            ),
          },
          {
            key: 'trigger',
            header: 'Trigger',
            cell: (rule) => <span className="text-sm">{describeTrigger(rule)}</span>,
          },
          {
            key: 'state',
            header: 'State',
            cell: (rule) =>
              mayManage ? (
                <RuleEnabledToggle organizationId={organizationId} rule={rule} />
              ) : (
                <Badge tone={rule.enabled ? 'accent' : 'neutral'}>
                  {rule.enabled ? 'Enabled' : 'Off'}
                </Badge>
              ),
          },
          {
            key: 'health',
            header: 'Health',
            cell: (rule) => {
              const issues = warningsByRule.get(rule.id) ?? [];
              if (issues.length === 0) {
                return <Badge tone="neutral">Ready</Badge>;
              }
              return (
                <Badge tone="neutral" title={issues.join(' ')} className="border-amber-500/40">
                  Needs attention
                </Badge>
              );
            },
          },
        ]}
      />

      {!mayManage ? (
        <Hint className="mt-4">
          Your role cannot write rules here. You can see what they are and what they have done.
        </Hint>
      ) : null}
    </div>
  );
}
