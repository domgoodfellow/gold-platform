import { DividedList } from '@/components/surfaces/section';
import { EmptyState } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import type { AutomationRun } from '@/lib/domain/automation/rules';
import type { MessageDelivery } from '@/lib/domain/automation/templates';

type ActivityItem = {
  key: string;
  at: string;
  label: string;
  result: string;
  failed: boolean;
};

/**
 * `AutomationRun` and `MessageDelivery` are two event streams this platform already keeps —
 * a rule acting, and a message going out. This is a presentation-only merge of the two, newest
 * first; it creates no new persisted entity and no new domain reader, the same restraint
 * `reporting.test.ts` holds the aggregate layer to.
 */
export function ActivityView({ runs, deliveries }: { runs: AutomationRun[]; deliveries: MessageDelivery[] }) {
  const items: ActivityItem[] = [
    ...runs.map((run) => ({
      key: `run-${run.id}`,
      at: run.occurredAt,
      label: run.ruleName,
      result: run.outcome === 'failed' ? `failed — ${run.detail}` : 'ran',
      failed: run.outcome === 'failed',
    })),
    ...deliveries.map((delivery) => ({
      key: `delivery-${delivery.id}`,
      at: delivery.queuedAt,
      label: delivery.ruleName,
      result:
        delivery.state === 'failed'
          ? `message failed — ${delivery.detail}`
          : delivery.state === 'sent'
            ? `message sent to ${delivery.recipient}`
            : `message queued for ${delivery.recipient}`,
      failed: delivery.state === 'failed',
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="mt-4">
      <Hint className="mb-2">
        What the rules have done and what they have said, together and newest first. A rule that
        did not apply records nothing — what is here is what happened.
      </Hint>

      {items.length === 0 ? (
        <EmptyState>Nothing has happened yet.</EmptyState>
      ) : (
        <DividedList>
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
              <span className="text-subtle">{new Date(item.at).toLocaleString('en-GB')}</span>
              <span className="font-medium">{item.label}</span>
              <span className={item.failed ? 'text-danger' : 'text-muted'}>{item.result}</span>
            </li>
          ))}
        </DividedList>
      )}
    </div>
  );
}
