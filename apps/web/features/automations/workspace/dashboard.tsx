'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Play,
  Mail,
  Zap,
} from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { PageHeader } from '@/components/headers/page-header';
import { MetricTile, OperationalPanel, PanelState } from '@/components/operational/primitives';
import { DataTable } from '@/components/display/table';
import type { AutomationDashboardData } from '@/lib/application/automations/dashboard';
import { NewAutomationSheet } from '../rules/new-automation-sheet';
import { RulesTable } from '../rules/rules-table';
import {
  AutomationState,
  automationDiagnostic,
  automationTime,
} from './operating-ui';
import { PeriodSelect } from '@/components/controls/period-select';

export function AutomationDashboard({
  organizationId,
  timezone,
  data,
  mayManage,
  configure,
  search,
}: {
  organizationId: string;
  timezone: string;
  data: AutomationDashboardData;
  mayManage: boolean;
  configure?: ReactNode;
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
      <PageHeader
        title="Automations"
        meta={<span className="text-xs">Execution period {data.period.dates[0]} – {data.period.dates.at(-1)} · {timezone}. Rule counts reflect current configuration.</span>}
        actions={<>
          <PeriodSelect label="Date range" value={data.period.when} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'Last 30 days' }].map((period) => ({ ...period, href: `?when=${period.value}` }))} />
          {mayManage && <NewAutomationSheet organizationId={organizationId} />}
          <ButtonLink href={activity} tone="secondary">View runs</ButtonLink>
          {configure}
        </>}
      />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {metrics.map(({ label, value, note, href, Icon }) => (
          <MetricTile
            key={label}
            label={label}
            value={value}
            detail={note}
            icon={Icon}
            href={href}
            emphasis={label === 'Failed runs' && Number(value) > 0 ? 'danger' : undefined}
          />
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(16rem,3fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <OperationalPanel density="compact"
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
              <PanelState>
                No issues recorded in this category. Provider availability is
                verified separately.
              </PanelState>
            )}
          </OperationalPanel>
          <OperationalPanel density="compact"
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
          </OperationalPanel>
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <OperationalPanel density="compact" title="Recent executions" href={activity}>
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
                <PanelState>
                  No execution attempts recorded in this period.
                </PanelState>
              )}
            </OperationalPanel>
            <OperationalPanel density="compact"
              title="Execution performance"
              action={
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
                <PanelState>
                  Execution trends will appear after the first recorded run.
                </PanelState>
              )}
            </OperationalPanel>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-3">
          <OperationalPanel density="compact" title="Recent activity" href={activity}>
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
              <PanelState>No activity recorded in this period.</PanelState>
            )}
          </OperationalPanel>
          <OperationalPanel density="compact" title="Automation health">
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
          </OperationalPanel>
          <OperationalPanel density="compact"
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
              <PanelState>No failed runs in this period.</PanelState>
            )}
          </OperationalPanel>
          <OperationalPanel density="compact" title="Insights">
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
              Run completion does not confirm delivery.
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
          </OperationalPanel>
        </aside>
      </div>
    </div>
  );
}
