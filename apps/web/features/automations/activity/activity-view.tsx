'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/display/table';
import { Button } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerDescription,
} from '@/components/panels/page-drawer';
import type { AutomationRun } from '@/lib/domain/automation/rules';
import type { MessageDelivery } from '@/lib/domain/automation/templates';
import {
  AutomationState,
  automationDiagnostic,
  automationTime,
} from '../workspace/operating-ui';

export type ActivityFilters = {
  when: string;
  q: string;
  stream: string;
  outcome: string;
  state: string;
  rule: string;
  page: number;
  from?: string;
  to?: string;
};
export function ActivityView({
  organizationId,
  timezone,
  runs,
  deliveries,
  selectedRun,
  selectedDelivery,
  filters,
  next,
  presentRuleIds,
}: {
  organizationId: string;
  timezone: string;
  runs: AutomationRun[];
  deliveries: MessageDelivery[];
  selectedRun?: AutomationRun;
  selectedDelivery?: MessageDelivery;
  filters: ActivityFilters;
  next: boolean;
  presentRuleIds: string[];
}) {
  const router = useRouter();
  const base = `/organizations/${organizationId}/automations`;
  const href = (change: Record<string, string>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (String(value)) query.set(key, String(value));
    for (const [key, value] of Object.entries(change)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    return `${base}/activity?${query}`;
  };
  const close = () =>
    router.push(href({ run: '', delivery: '' }), { scroll: false });
  return (
    <div className="min-w-0">
      <form className="my-3 flex flex-wrap items-center gap-2">
        {filters.from && filters.to ? <><input type="hidden" name="from" value={filters.from} /><input type="hidden" name="to" value={filters.to} /><span className="text-xs text-muted">{filters.from} to {filters.to} (exclusive)</span></> : null}
        <TextInput
          name="q"
          aria-label="Search execution history"
          placeholder="Search automation name…"
          defaultValue={filters.q}
          className="w-56"
          size="small"
        />
        <SelectInput
          name="when"
          aria-label="History period"
          defaultValue={filters.when}
          onChange={(event) => router.push(href({ when: event.target.value, from: '', to: '', page: '1' }))}
          size="small"
        >
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="all">All history</option>
        </SelectInput>
        <SelectInput
          name="stream"
          aria-label="Activity stream"
          defaultValue={filters.stream}
          size="small"
        >
          <option value="runs">Executions</option>
          <option value="deliveries">Message deliveries</option>
        </SelectInput>
        {filters.stream === 'deliveries' ? (
          <SelectInput
            name="state"
            aria-label="Delivery state"
            defaultValue={filters.state}
            size="small"
          >
            <option value="">All delivery states</option>
            <option value="queued">Queued</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="uncertain">Uncertain</option>
          </SelectInput>
        ) : (
          <SelectInput
            name="outcome"
            aria-label="Run outcome"
            defaultValue={filters.outcome}
            size="small"
          >
            <option value="">All outcomes</option>
            <option value="done">Completed</option>
            <option value="failed">Failed</option>
          </SelectInput>
        )}
        {filters.rule && (
          <input type="hidden" name="rule" value={filters.rule} />
        )}
        <Button size="small" tone="secondary">
          Apply filters
        </Button>
        <Link
          href={`${base}/activity?when=all`}
          className="text-xs text-accent-text"
        >
          Clear filters
        </Link>
      </form>
      <p className="mb-3 text-xs text-subtle">
        {timezone} ·{' '}
        {filters.stream === 'deliveries'
          ? 'Delivery states are independent of execution outcomes.'
          : 'Completed means the rule runtime completed. Inspect message delivery separately.'}
      </p>
      {filters.rule && (
        <p className="mb-3 text-xs">
          Filtered to one rule.{' '}
          {presentRuleIds.includes(filters.rule) && (
            <Link className="text-accent-text" href={`${base}/${filters.rule}`}>
              Open Rule Builder
            </Link>
          )}
        </p>
      )}
      {filters.stream === 'deliveries' ? (
        <DataTable
          rows={deliveries}
          rowKey={(d) => d.id}
          empty="No message deliveries match these filters."
          columns={[
            {
              key: 'at',
              header: 'Queued',
              cell: (d) => automationTime(d.queuedAt, timezone),
            },
            {
              key: 'rule',
              header: 'Automation',
              cell: (d) => (
                <Link
                  className="text-accent-text hover:underline"
                  href={href({ delivery: d.id })}
                >
                  {d.ruleName}
                </Link>
              ),
            },
            { key: 'channel', header: 'Channel', cell: (d) => d.channel },
            { key: 'recipient', header: 'Recipient', cell: (d) => d.recipient },
            {
              key: 'state',
              header: 'Delivery',
              cell: (d) => <AutomationState value={d.state} />,
            },
            {
              key: 'sent',
              header: 'Sent',
              cell: (d) =>
                d.sentAt ? automationTime(d.sentAt, timezone) : 'Not recorded',
            },
          ]}
        />
      ) : (
        <DataTable
          rows={runs}
          rowKey={(r) => r.id}
          empty="No execution attempts match these filters."
          columns={[
            {
              key: 'at',
              header: 'Time',
              cell: (r) => automationTime(r.occurredAt, timezone),
            },
            {
              key: 'rule',
              header: 'Automation',
              cell: (r) => (
                <Link
                  className="text-accent-text hover:underline"
                  href={href({ run: r.id })}
                >
                  {r.ruleName}
                </Link>
              ),
            },
            {
              key: 'result',
              header: 'Outcome',
              cell: (r) => <AutomationState value={r.outcome} />,
            },
            {
              key: 'subject',
              header: 'Related record',
              cell: (r) => (
                <Link
                  className="text-accent-text hover:underline"
                  href={`/organizations/${organizationId}/${r.subjectType === 'asset' ? 'assets' : 'work'}/${r.subjectId}`}
                >
                  {r.subjectType === 'asset' ? 'Asset' : 'Work'} ·{' '}
                  {r.subjectId.slice(0, 8)}
                </Link>
              ),
            },
            {
              key: 'detail',
              header: 'Diagnostic',
              cell: (r) => (
                <span className="line-clamp-2 text-xs text-subtle">
                  {r.detail
                    ? automationDiagnostic(r.detail)
                    : 'Execution completed'}
                </span>
              ),
            },
          ]}
        />
      )}
      <div className="mt-3 flex items-center gap-4 text-xs">
        <span>Page {filters.page} · up to 50 records per page</span>
        {filters.page > 1 && (
          <Link href={href({ page: String(filters.page - 1) })}>Previous</Link>
        )}
        {next && (
          <Link href={href({ page: String(filters.page + 1) })}>Next</Link>
        )}
      </div>
      <PageDrawer
        open={!!selectedRun || !!selectedDelivery}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <PageDrawerContent>
          <PageDrawerHeader>
            <PageDrawerTitle>
              {selectedDelivery
                ? 'Delivery inspection'
                : 'Execution inspection'}
            </PageDrawerTitle>
            <PageDrawerDescription>
              {selectedDelivery?.ruleName ?? selectedRun?.ruleName}
            </PageDrawerDescription>
          </PageDrawerHeader>
          <div className="space-y-4 text-sm">
            {selectedRun && (
              <>
                <AutomationState value={selectedRun.outcome} />
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs text-subtle">Execution time</dt>
                    <dd>{automationTime(selectedRun.occurredAt, timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle">Recorded result</dt>
                    <dd className="mt-1 break-words">
                      {selectedRun.detail
                        ? automationDiagnostic(selectedRun.detail)
                        : 'The runtime completed this rule.'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle">Related record</dt>
                    <dd>
                      <Link
                        className="text-accent-text"
                        href={`/organizations/${organizationId}/${selectedRun.subjectType === 'asset' ? 'assets' : 'work'}/${selectedRun.subjectId}`}
                      >
                        Open{' '}
                        {selectedRun.subjectType === 'asset'
                          ? 'Asset'
                          : 'Work item'}
                      </Link>
                    </dd>
                  </div>
                </dl>
                {presentRuleIds.includes(selectedRun.ruleId) ? (
                  <Link
                    className="block text-accent-text"
                    href={`${base}/${selectedRun.ruleId}`}
                  >
                    Open current Rule Builder
                  </Link>
                ) : (
                  <p className="text-xs text-subtle">
                    This rule was deleted. Its execution history remains
                    recorded.
                  </p>
                )}
                <p className="text-xs text-subtle">
                  The rule name above was saved at execution time. Historical
                  runs do not snapshot individual action configuration or
                  per-action results. Current configuration may have changed.
                </p>
                <Link
                  className="block text-accent-text"
                  href={href({
                    stream: 'deliveries',
                    q: selectedRun.ruleName,
                    rule: '',
                    run: '',
                    when: 'all',
                  })}
                >
                  Inspect deliveries with this recorded rule name
                </Link>
                <p className="text-xs text-subtle">
                  Name matching is a monitoring filter, not proof of an exact
                  run-to-delivery relationship.
                </p>
              </>
            )}
            {selectedDelivery && (
              <>
                <AutomationState value={selectedDelivery.state} />
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs text-subtle">Channel / recipient</dt>
                    <dd className="break-all">
                      {selectedDelivery.channel} · {selectedDelivery.recipient}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle">Queued</dt>
                    <dd>
                      {automationTime(selectedDelivery.queuedAt, timezone)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle">Sent</dt>
                    <dd>
                      {selectedDelivery.sentAt
                        ? automationTime(selectedDelivery.sentAt, timezone)
                        : 'Not recorded'}
                    </dd>
                  </div>
                </dl>
                {selectedDelivery.detail && (
                  <p className="break-words rounded-md border border-border p-3">
                    {selectedDelivery.detail}
                  </p>
                )}
                <div className="rounded-md border border-border p-3">
                  <h3 className="mb-2 font-medium">
                    {selectedDelivery.subjectLine || 'Message content'}
                  </h3>
                  <p className="whitespace-pre-wrap break-words">
                    {selectedDelivery.body}
                  </p>
                </div>
                <p className="text-xs text-subtle">
                  Content was snapshotted when queued. Template edits do not
                  change it. Sent means the email provider accepted the message
                  from this business&apos;s own sender address; a later provider report
                  says whether it was delivered. Uncertain means an attempt may have
                  reached the provider but was never confirmed: it is not sent again
                  automatically, so check with the recipient before sending it
                  yourself.
                </p>
              </>
            )}
          </div>
        </PageDrawerContent>
      </PageDrawer>
    </div>
  );
}
