import Link from 'next/link';
import { DataTable } from '@/components/display/table';
import type { AutomationRule } from '@/lib/domain/automation/rules';
import type { RuleWarning } from '@/lib/domain/automation/review';
import type { AutomationSummary } from '@/lib/domain/automation/monitoring';
import { AutomationState, automationTime } from '../workspace/operating-ui';
import { describeTrigger } from './trigger';
import { RuleEnabledToggle } from './rule-enabled-toggle';

export function RulesTable({
  organizationId,
  rules,
  warnings,
  mayManage,
  summary,
  timezone = 'UTC',
  compact = false,
}: {
  organizationId: string;
  rules: AutomationRule[];
  warnings: RuleWarning[];
  mayManage: boolean;
  summary?: AutomationSummary;
  timezone?: string;
  compact?: boolean;
}) {
  const base = `/organizations/${organizationId}/automations`;
  return (
    <div className="mt-2">
      <DataTable
        rows={rules}
        rowKey={(r) => r.id}
        empty="No matching automations. Create a rule to configure its trigger, conditions and actions."
        columns={[
          {
            key: 'name',
            header: 'Automation',
            emphasis: 'primary',
            cell: (r) => (
              <Link
                href={`${base}/${r.id}`}
                className="block max-w-44 whitespace-normal text-xs font-medium text-blue-600 hover:underline"
              >
                {r.name}
              </Link>
            ),
          },
          {
            key: 'trigger',
            header: 'Trigger',
            cell: (r) => (
              <span className="block max-w-40 whitespace-normal text-xs text-subtle">
                {describeTrigger(r)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (r) => (
              <span className="block max-w-28 whitespace-normal text-xs text-subtle">
                {r.actions.length
                  ? r.actions
                      .map(
                        (a) =>
                          ({
                            change_status: 'Change status',
                            notify: 'Notify Customer',
                            shift_schedule: 'Shift schedule',
                            create_work_item: 'Create Work',
                          })[a.kind],
                      )
                      .join(' + ')
                  : 'No actions'}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <AutomationState value={r.enabled ? 'Enabled' : 'Disabled'} />
            ),
          },
          {
            key: 'health',
            header: 'Configuration',
            cell: (r) => (
              <Link
                href={`${base}/${r.id}?node=diagnostics`}
                className={`text-xs hover:underline ${warnings.some((w) => w.ruleId === r.id) ? 'text-amber-600' : 'text-subtle'}`}
              >
                {!r.actions.length
                  ? 'Incomplete'
                  : warnings.some((w) => w.ruleId === r.id)
                    ? 'Needs review'
                    : 'No warnings'}
              </Link>
            ),
          },
          ...(!compact
            ? [
                {
                  key: 'last',
                  header: 'Last run',
                  cell: (r: AutomationRule) => {
                    const last = summary?.rules.find((s) => s.rule_id === r.id);
                    return last ? (
                      <Link
                        href={`${base}/activity?when=all&run=${last.last_id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {automationTime(last.last_at, timezone)}
                        <span className="ml-2">
                          <AutomationState value={last.last_outcome} />
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-subtle">
                        No recorded executions
                      </span>
                    );
                  },
                },
              ]
            : []),
        ]}
        actions={
          compact
            ? undefined
            : (r) => (
                <div className="flex items-center gap-2">
                  <Link
                    className="text-xs text-blue-600 hover:underline"
                    href={`${base}/${r.id}`}
                  >
                    Edit / inspect
                  </Link>
                  {mayManage && (
                    <RuleEnabledToggle
                      organizationId={organizationId}
                      rule={r}
                      size="tiny"
                    />
                  )}
                </div>
              )
        }
      />
    </div>
  );
}
