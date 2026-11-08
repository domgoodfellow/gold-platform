'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowLeft,
  Zap,
  Filter,
  Workflow,
  ShieldCheck,
  Eye,
  History,
  LockKeyhole,
  ChevronRight,
} from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import type { AutomationRule } from '@/lib/domain/automation/rules';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { MessageTemplate } from '@/lib/domain/automation/templates';
import type { ToolChoice } from '@/lib/domain/integrations/tool-access';
import type { StatusChoice } from './rule-detail-types';
import { describeTrigger } from './trigger';
import { RuleHeading } from './rule-heading';
import { NewAutomationSheet } from './new-automation-sheet';
import { RemoveRuleNode } from './remove-node';
import { AddActionSheet } from './add-action-sheet';
import { AddConditionSheet } from './add-condition-sheet';
import { RuleWarnings } from '../review/rule-warnings';
import { AutomationState } from '../workspace/operating-ui';

// Plain words for the codes a rule stores; a code is never shown as stored.
const FIELD_WORD: Record<string, string> = { title: 'Title', status_id: 'Stage', type_id: 'Kind of work', customer_id: 'Customer', resource_id: 'Resource', location_id: 'Location', asset_id: 'Asset' };
const OPERATOR_WORD: Record<string, string> = { equals: 'is', not_equals: 'is not', is_set: 'has been filled in', is_empty: 'is empty' };
const CHANNEL_WORD: Record<string, string> = { email: 'Email', sms: 'Text message' };

const actionNames = {
  change_status: 'Change stage',
  notify: 'Notify Customer',
  shift_schedule: 'Shift scheduled Work',
  create_work_item: 'Create Work item',
  run_tool: 'Use a connected tool',
};

export function RuleBuilder({
  organizationId,
  rule,
  statuses,
  templates,
  types,
  definitions,
  warnings,
  mayManage,
  initialNode,
  toolChoices = [],
}: {
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  templates: MessageTemplate[];
  types: { id: string; name: string }[];
  definitions: FieldDefinition[];
  warnings: string[];
  mayManage: boolean;
  initialNode?: string;
  toolChoices?: ToolChoice[];
}) {
  const [selected, setSelected] = useState(initialNode ?? 'trigger');
  const [mobileInspector, setMobileInspector] = useState(false);
  const base = `/organizations/${organizationId}/automations`;
  const select = (node: string) => {
    setSelected(node);
    setMobileInspector(true);
    const url = new URL(window.location.href);
    url.searchParams.set('node', node);
    window.history.replaceState(null, '', url);
  };
  const condition = rule.conditions.find((c) => c.id === selected);
  const action = rule.actions.find((a) => a.id === selected);
  const summary = (a: AutomationRule['actions'][number]) =>
    a.kind === 'run_tool'
      ? `${a.toolLabel ?? 'A connected tool'} · reads only`
      : a.kind === 'notify'
      ? `${templates.find((t) => t.id === a.templateId)?.name ?? 'Missing template'} · ${(a.channel && CHANNEL_WORD[a.channel]) ?? 'Message'} · the job's customer`
      : a.kind === 'shift_schedule'
        ? `${Math.abs(a.shiftMinutes ?? 0)} minutes ${(a.shiftMinutes ?? 0) < 0 ? 'earlier' : 'later'}`
        : `${a.kind === 'create_work_item' ? `${types.find((t) => t.id === a.typeId)?.name ?? 'Missing kind of work'} · ` : ''}${statuses.find((s) => s.id === a.statusId)?.label ?? 'Missing stage'}`;
  const conditionText = (c: AutomationRule['conditions'][number]) =>
    `${definitions.find((d) => `custom.${d.key}` === c.subjectField)?.label ?? FIELD_WORD[c.subjectField] ?? 'A field'} ${OPERATOR_WORD[c.operator] ?? 'is'} ${statuses.find((s) => s.id === c.value)?.label ?? c.value ?? ''}`;
  const nodeClass = (id: string) =>
    `w-full rounded-lg border bg-background p-4 text-left shadow-sm transition-colors hover:border-border ${selected === id ? 'border-accent ring-2 ring-ring/30' : 'border-border'}`;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <Link
          href={base}
          className="flex items-center gap-1 text-xs text-subtle hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Automations
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <AutomationState value={rule.enabled ? 'Enabled' : 'Disabled'} />
          <Button
            size="tiny"
            tone="secondary"
            onClick={() => select('diagnostics')}
          >
            <ShieldCheck className="size-3.5" />{' '}
            {warnings.length ? `${warnings.length} warnings` : 'Checks'}
          </Button>
          <Button
            size="tiny"
            tone="secondary"
            onClick={() => select('preview')}
          >
            <Eye className="size-3.5" /> Inspect rule
          </Button>
          <ButtonLink
            size="tiny"
            href={`${base}/activity?when=all&rule=${rule.id}`}
          >
            <History className="size-3.5" /> History
          </ButtonLink>
        </div>
      </div>
      <h1
        className={
          mayManage ? 'sr-only' : 'text-xl font-semibold tracking-tight'
        }
      >
        {rule.name}
      </h1>
      {mayManage ? (
        <RuleHeading organizationId={organizationId} rule={rule} />
      ) : (
        <p className="text-xs text-subtle">
          Read-only access. Your role cannot change this rule.
        </p>
      )}
      <div className="grid min-w-0 grid-cols-1 overflow-hidden rounded-xl border border-border lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          aria-label="Workflow canvas"
          className={`${mobileInspector ? 'hidden lg:block' : ''} min-w-0 bg-secondary p-4 sm:p-6`}
        >
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Rule workflow</h2>
            </div>
            <Workflow className="size-5 text-subtle" />
          </div>
          <div className="mx-auto flex w-full max-w-xl flex-col items-center">
            <button
              type="button"
              className={nodeClass('trigger')}
              onClick={() => select('trigger')}
              aria-pressed={selected === 'trigger'}
            >
              <span className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-accent-text">
                <Zap className="size-4" /> Trigger{' '}
                <LockKeyhole className="ml-auto size-3" />
              </span>
              <span className="block text-sm font-medium">
                {describeTrigger(rule)}
              </span>
              <span className="mt-1 block text-xs text-subtle">
                Starts this automation
              </span>
            </button>
            <ArrowDown aria-hidden className="my-3 size-5 text-subtle" />
            <div className="w-full rounded-xl border border-dashed border-border p-3">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium text-subtle">
                <Filter className="size-4" /> Conditions · ALL must match
              </h3>
              <div className="space-y-3">
                {rule.conditions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={nodeClass(c.id)}
                    onClick={() => select(c.id)}
                    aria-pressed={selected === c.id}
                  >
                    <span className="block text-sm">{conditionText(c)}</span>
                    <span className="mt-2 flex items-center justify-between text-xs text-subtle">
                      Work condition <ChevronRight className="size-3" />
                    </span>
                  </button>
                ))}
              </div>
              {!rule.conditions.length && (
                <p className="mb-3 text-xs text-subtle">
                  {rule.triggerKind === 'counter_threshold'
                    ? 'Asset counter rules do not evaluate Work conditions.'
                    : 'No conditions. Every matching trigger qualifies.'}
                </p>
              )}
              {mayManage && rule.triggerKind !== 'counter_threshold' && (
                <div className="mt-3">
                  <AddConditionSheet
                    organizationId={organizationId}
                    rule={rule}
                    statuses={statuses}
                    definitions={definitions}
                    types={types}
                  />
                </div>
              )}
            </div>
            <ArrowDown aria-hidden className="my-3 size-5 text-subtle" />
            <div className="w-full space-y-3">
              {rule.actions.map((a, index) => (
                <div key={a.id}>
                  <button
                    type="button"
                    className={nodeClass(a.id)}
                    onClick={() => select(a.id)}
                    aria-pressed={selected === a.id}
                  >
                    <span className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-success">
                      <Workflow className="size-4" /> Action {index + 1}
                    </span>
                    <span className="block text-sm font-medium">
                      {actionNames[a.kind]}
                    </span>
                    <span className="mt-1 block text-xs text-subtle">
                      {summary(a)}
                    </span>
                  </button>
                  {index < rule.actions.length - 1 && (
                    <span className="mt-3 flex w-full justify-center">
                      <ArrowDown aria-hidden className="size-5 text-subtle" />
                    </span>
                  )}
                </div>
              ))}
              {!rule.actions.length && (
                <div className="rounded-lg border border-dashed border-warning/30 p-4 text-xs text-subtle">
                  No actions yet. This rule does nothing until you add one.
                </div>
              )}
              {mayManage && (
                <AddActionSheet
                  organizationId={organizationId}
                  rule={rule}
                  statuses={statuses}
                  templates={templates}
                  types={types}
                  toolChoices={toolChoices}
                />
              )}
            </div>
          </div>
        </section>
        <aside
          aria-label="Node inspector"
          className={`${mobileInspector ? '' : 'hidden lg:block'} min-w-0 border-border bg-background lg:border-l`}
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="text-sm font-semibold">
              {selected === 'trigger'
                ? 'Trigger'
                : selected === 'preview'
                  ? 'Read-only inspection'
                  : selected === 'diagnostics'
                    ? 'Checks'
                    : condition
                      ? 'Condition'
                      : action
                        ? 'Action'
                        : 'Select a node'}
            </h2>
            <Button
              size="tiny"
              tone="text"
              className="lg:hidden"
              onClick={() => setMobileInspector(false)}
            >
              Back to canvas
            </Button>
          </div>
          <div className="space-y-5 p-4">
            {selected === 'trigger' && (
              <>
                <div className="rounded-md bg-accent p-3">
                  <Zap className="mb-2 size-5 text-accent-text" />
                  <p className="text-sm font-medium">{describeTrigger(rule)}</p>
                </div>
                <p className="text-xs text-subtle">
                  The trigger is fixed after creation to preserve the meaning of
                  historical executions. Create another rule to use a different
                  trigger.
                </p>
                {mayManage && (
                  <NewAutomationSheet organizationId={organizationId} />
                )}
                {(rule.triggerKind === 'external_reading' ||
                  rule.triggerKind === 'counter_threshold' ||
                  rule.triggerKind === 'schedule') && (
                  <p className="rounded-md border border-warning/30 p-3 text-xs text-subtle">
                    {rule.triggerKind === 'external_reading'
                      ? 'Needs incoming readings in exactly this unit.'
                      : rule.triggerKind === 'schedule'
                        ? 'Runs for scheduled work, counted from when the work starts. It does not repeat.'
                        : 'Needs asset readings in this unit. The only action for an asset is Create work.'}
                  </p>
                )}
              </>
            )}
            {condition && (
              <>
                <p className="text-sm">{conditionText(condition)}</p>
                <p className="text-xs text-subtle">
                  Every condition must match. Saving changes this condition
                  atomically.
                </p>
                {mayManage && (
                  <AddConditionSheet
                    key={condition.id}
                    organizationId={organizationId}
                    rule={rule}
                    statuses={statuses}
                    definitions={definitions}
                    types={types}
                    condition={condition}
                  />
                )}
                {mayManage && (
                  <RemoveRuleNode
                    organizationId={organizationId}
                    ruleId={rule.id}
                    nodeId={condition.id}
                    kind="condition"
                  />
                )}
              </>
            )}
            {action && (
              <>
                <p className="text-sm font-medium">
                  {actionNames[action.kind]}
                </p>
                <p className="text-xs text-subtle">{summary(action)}</p>
                {mayManage && action.kind !== 'run_tool' && (
                  <AddActionSheet
                    key={action.id}
                    organizationId={organizationId}
                    rule={rule}
                    statuses={statuses}
                    templates={templates}
                    types={types}
                    action={action}
                  />
                )}
                {mayManage && (
                  <RemoveRuleNode
                    organizationId={organizationId}
                    ruleId={rule.id}
                    nodeId={action.id}
                    kind="action"
                  />
                )}
              </>
            )}
            {(selected === 'diagnostics' || selected === 'preview') && (
              <>
                <p className="text-xs text-subtle">
                  Nothing is sent or changed here.
                </p>
                <dl className="space-y-3 text-xs">
                  <div>
                    <dt className="text-subtle">Trigger</dt>
                    <dd className="mt-1">{describeTrigger(rule)}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Conditions</dt>
                    <dd>{rule.conditions.length} · all must match</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Actions</dt>
                    <dd>{rule.actions.length} · sequential</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Structure</dt>
                    <dd>
                      {rule.actions.length
                        ? 'Has actions'
                        : 'Incomplete: add an action'}
                    </dd>
                  </div>
                </dl>
                {warnings.length ? (
                  <RuleWarnings warnings={warnings} />
                ) : (
                  <p className="rounded-md border border-border p-3 text-xs">
                    No warnings.
                  </p>
                )}
                <p className="text-xs text-subtle">
                  Once switched on, actions can change live work and send messages to customers.
                </p>
                <ButtonLink
                  href={`${base}/activity?when=all&rule=${rule.id}`}
                  size="small"
                >
                  Inspect observed executions
                </ButtonLink>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
