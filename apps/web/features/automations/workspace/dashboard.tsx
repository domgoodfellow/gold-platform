'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Play,
  Settings,
  Mail,
  Zap,
} from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import type { AutomationDashboardData } from '@/lib/application/automations/dashboard';
import { NewAutomationSheet } from '../rules/new-automation-sheet';
import { RulesTable } from '../rules/rules-table';
import {
  AutomationPanel,
  AutomationState,
  automationDiagnostic,
  automationTime,
  PanelEmpty,
} from './operating-ui';

export function AutomationDashboard({
  organizationId,
  timezone,
  data,
  mayManage,
  mayConfigure,
  search,
}: {
  organizationId: string;
  timezone: string;
  data: AutomationDashboardData;
  mayManage: boolean;
  mayConfigure: boolean;
  search: string;
}) {
  const [attention, setAttention] = useState('runs');
  const [ruleState, setRuleState] = useState('all');
  const base = `/organizations/${organizationId}/automations`;
  const periodQuery = `when=${data.period.when}`;
  const activity = `${base}/activity?${periodQuery}`;
  const warningIds = new Set(data.warnings.map((w) => w.ruleId));
  const active = data.rules.filter((r) => r.enabled).length;
  const failures = data.summary.rules.filter((r) => r.failed > 0);
  const metrics = [
    {
      label: 'Active automations',
      value: active,
      note: `${data.rules.length} rules in total`,
      href: `${base}/rules?status=enabled`,
      Icon: Play,
    },
    {
      label: 'Runs in period',
      value: data.summary.runs,
      note: 'Recorded execution attempts',
      href: activity,
      Icon: Activity,
    },
    {
      label: 'Failed runs',
      value: data.summary.failed,
      note: `${failures.length} rules affected`,
      href: `${activity}&outcome=failed`,
      Icon: AlertTriangle,
    },
    {
      label: 'Execution success',
      value: data.summary.runs
        ? `${(((data.summary.runs - data.summary.failed) / data.summary.runs) * 100).toFixed(1)}%`
        : '—',
      note: data.summary.runs
        ? 'Completed runs / all attempts'
        : 'No execution data yet',
      href: `${activity}&outcome=done`,
      Icon: CheckCircle2,
    },
  ];
  const issues =
    attention === 'runs'
      ? data.failedRuns.map((r) => ({
          id: r.id,
          name: r.ruleName,
          problem: automationDiagnostic(r.detail),
          at: automationTime(r.occurredAt, timezone),
          state: 'failed',
          href: `${activity}&run=${r.id}`,
        }))
      : attention === 'deliveries'
        ? data.failedDeliveries.map((d) => ({
            id: d.id,
            name: d.ruleName,
            problem: automationDiagnostic(d.detail),
            at: automationTime(d.queuedAt, timezone),
            state: 'failed',
            href: `${activity}&stream=deliveries&delivery=${d.id}`,
          }))
        : data.warnings
            .filter(
              (w) =>
                attention !== 'readiness' ||
                /unit|reading|counter|customer|field/i.test(w.message),
            )
            .slice(0, 5)
            .map((w, i) => ({
              id: `${w.ruleId}-${i}`,
              name: data.rules.find((r) => r.id === w.ruleId)?.name ?? 'Rule',
              problem: w.message,
              at: 'Current configuration',
              state: 'Review',
              href: `${base}/${w.ruleId}?node=diagnostics`,
            }));
  const filteredRules = data.rules.filter(
    (r) =>
      (!search || r.name.toLowerCase().includes(search.toLowerCase())) &&
      (ruleState === 'all' ||
        (ruleState === 'enabled' ? r.enabled : !r.enabled)),
  );
  const events = [
    ...data.runs.map((r) => ({
      id: r.id,
      name: r.ruleName,
      state: r.outcome,
      at: r.occurredAt,
      href: `${activity}&run=${r.id}`,
      Icon: Zap,
    })),
    ...data.deliveries.map((d) => ({
      id: d.id,
      name: d.ruleName,
      state: d.state,
      at: d.sentAt ?? d.queuedAt,
      href: `${activity}&stream=deliveries&delivery=${d.id}`,
      Icon: Mail,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  const maxDay = Math.max(1, ...data.summary.days.map((d) => d.total));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="mt-0.5 text-xs text-subtle">
            Rules, workflows, execution, and monitoring.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <form className="flex min-w-0 flex-wrap items-center gap-2">
            <TextInput
              name="q"
              aria-label="Search automations"
              placeholder="Search automations…"
              defaultValue={search}
              className="w-48"
              size="small"
            />
            <SelectInput
              name="when"
              aria-label="Date range"
              defaultValue={data.period.when}
              size="small"
            >
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </SelectInput>
            <Button size="tiny" tone="secondary">
              Apply
            </Button>
          </form>
          {mayManage && <NewAutomationSheet organizationId={organizationId} />}
          <ButtonLink href={activity} size="small">
            View runs
          </ButtonLink>
          {mayConfigure && (
            <ButtonLink
              href={`/organizations/${organizationId}/settings/features`}
              size="small"
            >
              <Settings className="size-3.5" /> Configure
            </ButtonLink>
          )}
        </div>
      </header>
      <p className="text-[11px] text-subtle">
        Execution period: {data.period.dates[0]} – {data.period.dates.at(-1)} ·{' '}
        {timezone}. Rule counts reflect current configuration.
      </p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {metrics.map(({ label, value, note, href, Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-3 transition-colors hover:bg-hover"
          >
            <span className="rounded-full bg-secondary p-2.5">
              <Icon
                className={`size-5 ${label === 'Failed runs' ? 'text-warning' : label === 'Active automations' ? 'text-success' : ''}`}
              />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-subtle">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
              <p className="text-[10px] text-subtle">{note}</p>
            </div>
          </Link>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(16rem,3fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <AutomationPanel
            title="Needs attention"
            href={
              attention === 'runs'
                ? `${activity}&outcome=failed`
                : attention === 'deliveries'
                  ? `${activity}&stream=deliveries&state=failed`
                  : `${base}/rules?health=attention`
            }
          >
            <div
              className="mb-2 flex flex-wrap gap-1"
              aria-label="Attention categories"
            >
              {[
                ['runs', `Failed runs (${data.summary.failed})`],
                [
                  'deliveries',
                  `Failed deliveries (${data.summary.deliveries.failed ?? 0})`,
                ],
                ['rules', `Rules needing review (${warningIds.size})`],
                ['readiness', 'Readiness'],
              ].map(([key, label]) => (
                <Button
                  key={key}
                  size="tiny"
                  tone={attention === key ? 'primary' : 'text'}
                  aria-pressed={attention === key}
                  onClick={() => setAttention(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {issues.length ? (
              <DataTable
                empty="No issues"
                rows={issues}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'name',
                    header: 'Automation',
                    cell: (r) => (
                      <Link
                        className="text-accent-text hover:underline"
                        href={r.href}
                      >
                        {r.name}
                      </Link>
                    ),
                  },
                  {
                    key: 'problem',
                    header: 'Problem',
                    cell: (r) => (
                      <span
                        className="line-clamp-2 max-w-72 whitespace-normal break-words text-xs"
                        title={r.problem}
                      >
                        {r.problem}
                      </span>
                    ),
                  },
                  {
                    key: 'at',
                    header: 'Last occurrence',
                    cell: (r) => (
                      <span className="block max-w-24 whitespace-normal text-xs text-subtle">
                        {r.at}
                      </span>
                    ),
                  },
                  {
                    key: 'state',
                    header: 'Status',
                    cell: (r) => <AutomationState value={r.state} />,
                  },
                ]}
              />
            ) : (
              <PanelEmpty>
                No issues recorded in this category. Provider availability is
                verified separately.
              </PanelEmpty>
            )}
          </AutomationPanel>
          <AutomationPanel
            title="Automation library"
            href={`${base}/rules${search ? `?q=${encodeURIComponent(search)}` : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                {['all', 'enabled', 'disabled'].map((state) => (
                  <Button
                    key={state}
                    size="tiny"
                    tone={ruleState === state ? 'primary' : 'text'}
                    aria-pressed={ruleState === state}
                    onClick={() => setRuleState(state)}
                  >
                    {state === 'all'
                      ? `All (${data.rules.length})`
                      : state === 'enabled'
                        ? `Enabled (${active})`
                        : `Disabled (${data.rules.length - active})`}
                  </Button>
                ))}
              </div>
              <Link
                href={`${base}/messages`}
                className="text-xs text-accent-text hover:underline"
              >
                Message templates
              </Link>
            </div>
            <RulesTable
              organizationId={organizationId}
              rules={filteredRules.slice(0, 6)}
              warnings={data.warnings}
              mayManage={mayManage}
              summary={data.summary}
              timezone={timezone}
              compact
            />
            {filteredRules.length > 6 && (
              <p className="mt-2 text-xs text-subtle">
                Showing 6 of {filteredRules.length} matching rules.
              </p>
            )}
          </AutomationPanel>
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <AutomationPanel title="Recent executions" href={activity}>
              {data.runs.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-subtle">
                      <tr>
                        <th scope="col" className="pb-2 font-normal">
                          Time
                        </th>
                        <th scope="col" className="pb-2 font-normal">
                          Automation
                        </th>
                        <th scope="col" className="pb-2 font-normal">
                          Result
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.runs.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 pr-2 text-subtle">
                            {automationTime(r.occurredAt, timezone)}
                          </td>
                          <td className="py-2 pr-2">
                            <Link
                              className="text-accent-text hover:underline"
                              href={`${activity}&run=${r.id}`}
                            >
                              {r.ruleName}
                            </Link>
                          </td>
                          <td className="py-2">
                            <AutomationState value={r.outcome} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <PanelEmpty>
                  No execution attempts recorded in this period.
                </PanelEmpty>
              )}
            </AutomationPanel>
            <AutomationPanel
              title="Execution performance"
              note={
                <span className="text-[10px] text-subtle">
                  Runs by local date
                </span>
              }
            >
              {data.summary.runs ? (
                <div className="flex flex-col gap-2">
                  {data.period.dates.map((day) => {
                    const point = data.summary.days.find((d) => d.day === day);
                    return (
                      <div
                        key={day}
                        className="grid grid-cols-[3rem_1fr_2rem] items-center gap-2 text-[10px]"
                      >
                        <span className="text-subtle">{day.slice(5)}</span>
                        <meter
                          aria-label={`${day} runs`}
                          min={0}
                          max={maxDay}
                          value={point?.total ?? 0}
                          className="h-3 w-full accent-[var(--accent)]"
                        />
                        <span className="text-right tabular-nums">
                          {point?.total ?? 0}
                        </span>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-subtle">
                    {data.summary.runs - data.summary.failed} completed ·{' '}
                    {data.summary.failed} failed
                  </p>
                </div>
              ) : (
                <PanelEmpty>
                  Execution trends will appear after the first recorded run.
                </PanelEmpty>
              )}
            </AutomationPanel>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-3">
          <AutomationPanel title="Recent activity" href={activity}>
            {events.length ? (
              <ul className="divide-y divide-border">
                {events.map(({ id, name, state, at, href, Icon }) => (
                  <li key={id}>
                    <Link
                      href={href}
                      className="flex items-start gap-2 py-2 hover:bg-hover"
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">{name}</p>
                        <p className="mt-0.5 text-[10px] text-subtle">
                          {automationTime(at, timezone)}
                        </p>
                      </div>
                      <AutomationState value={state} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty>No activity recorded in this period.</PanelEmpty>
            )}
          </AutomationPanel>
          <AutomationPanel title="Automation health">
            <dl className="divide-y divide-border text-xs">
              {[
                ['Enabled rules', active],
                ['Disabled rules', data.rules.length - active],
                ['Rules with warnings', warningIds.size],
                ['Rules with failures in period', failures.length],
                [
                  'Rules with no recorded executions',
                  data.rules.filter(
                    (r) => !data.summary.rules.some((s) => s.rule_id === r.id),
                  ).length,
                ],
                [
                  'Failed deliveries in period',
                  data.summary.deliveries.failed ?? 0,
                ],
              ].map(([label, count]) => (
                <div key={label} className="flex justify-between gap-2 py-2">
                  <dt className="text-subtle">{label}</dt>
                  <dd className="font-semibold tabular-nums">{count}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[10px] text-subtle">
              No history may mean no matching trigger. Configuration checks do
              not verify external providers.
            </p>
          </AutomationPanel>
          <AutomationPanel
            title="Recent failures"
            href={`${activity}&outcome=failed`}
          >
            {data.failedRuns.length ? (
              <ul className="divide-y divide-border">
                {data.failedRuns.slice(0, 3).map((r) => (
                  <li key={r.id} className="py-2">
                    <Link
                      href={`${activity}&run=${r.id}`}
                      className="text-xs text-accent-text hover:underline"
                    >
                      {r.ruleName}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-[11px] text-subtle">
                      {automationDiagnostic(r.detail)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty>No failed runs in this period.</PanelEmpty>
            )}
          </AutomationPanel>
          <AutomationPanel title="Insights">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] text-subtle">Messages sent</p>
                <p className="text-xl font-semibold">
                  {data.summary.deliveries.sent ?? 0}
                </p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] text-subtle">Messages queued</p>
                <p className="text-xl font-semibold">
                  {data.summary.deliveries.queued ?? 0}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-subtle">
              Delivery states for messages queued in the selected period. Run
              completion does not confirm delivery.
            </p>
            <div className="mt-3 space-y-2">
              {[...data.summary.rules]
                .filter((r) => r.total > 0)
                .sort((a, b) => b.total - a.total)
                .slice(0, 3)
                .map((r) => (
                  <Link
                    key={r.rule_id}
                    href={`${activity}&rule=${r.rule_id}`}
                    className="flex justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate text-subtle">
                      {data.rules.find((rule) => rule.id === r.rule_id)?.name ??
                        'Historical rule'}
                    </span>
                    <span>{r.total} runs</span>
                  </Link>
                ))}
            </div>
          </AutomationPanel>
        </aside>
      </div>
    </div>
  );
}
