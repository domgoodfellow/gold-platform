'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AlertTriangle, CircleCheck, History, ListOrdered, LockKeyhole, Network, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@gold/ui/components/alert';
import { Item, ItemContent, ItemGroup, ItemMedia } from '@gold/ui/components/item';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { Button, ButtonLink } from '@/components/controls/button';
import { cx } from '@/components/class-names';
import { Card } from '@/components/surfaces/card';
import type { AutomationRule, AutomationRun } from '@/lib/domain/automation/rules';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { MessageTemplate } from '@/lib/domain/automation/templates';
import type { ToolChoice } from '@/lib/domain/integrations/tool-access';
import type { WorkflowGraph } from '@/lib/domain/automation/workflow-graph';
import { paletteFor } from '@/lib/domain/automation/workflow-nodes';
import type { StatusChoice } from '../rules/rule-detail-types';
import { RuleHeading } from '../rules/rule-heading';
import { NewAutomationSheet } from '../rules/new-automation-sheet';
import { RemoveRuleNode } from '../rules/remove-node';
import { AddActionSheet } from '../rules/add-action-sheet';
import { AddConditionSheet } from '../rules/add-condition-sheet';
import { AutomationState, automationDiagnostic, automationTime } from '../workspace/operating-ui';
import { automationPaths } from '../paths';
import { WorkflowList } from './workflow-list';
import { nodeHeading, type WorkflowView } from './renderer';

// The canvas is loaded only where it is drawn, so a phone never downloads it.
const WorkflowCanvas = dynamic(() => import('./workflow-canvas'), {
  ssr: false,
  loading: () => <div className="h-144 w-full" />,
});

const DESKTOP = '(min-width: 1024px)';

const VIEWS = [
  { value: 'canvas', label: 'Canvas', Icon: Network },
  { value: 'list', label: 'Steps', Icon: ListOrdered },
] as const;

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return desktop;
}

/**
 * One workflow, drawn and edited.
 *
 * The graph is a projection of the stored rule (`projectRule`). Both renderers read it, the
 * inspector edits it through the existing rule commands, and the server re-projects it after every
 * save — so the canvas, the step list and a reload always show the same rows. The chosen view and
 * step live in the address, so a reload or a shared link reopens the same place.
 */
export function WorkflowWorkbench({
  organizationId,
  rule,
  graph,
  statuses,
  templates,
  types,
  definitions,
  recentRuns,
  timezone,
  mayManage,
  initialNode,
  initialView,
  toolChoices = [],
}: {
  organizationId: string;
  rule: AutomationRule;
  graph: WorkflowGraph;
  statuses: StatusChoice[];
  templates: MessageTemplate[];
  types: { id: string; name: string }[];
  definitions: FieldDefinition[];
  recentRuns: AutomationRun[];
  timezone: string;
  mayManage: boolean;
  initialNode?: string;
  initialView?: WorkflowView;
  toolChoices?: ToolChoice[];
}) {
  const paths = automationPaths(organizationId);
  const desktop = useDesktop();
  const [selected, setSelected] = useState(initialNode === 'preview' ? 'diagnostics' : (initialNode ?? 'trigger'));
  const [inspecting, setInspecting] = useState(Boolean(initialNode));
  const [view, setView] = useState<WorkflowView>(initialView ?? 'canvas');
  // A phone always gets the step list; the canvas is a wide-screen choice.
  const shown: WorkflowView = desktop ? view : 'list';

  const writeAddress = (key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState(null, '', url);
  };
  const select = useCallback((node: string) => {
    setSelected(node);
    setInspecting(true);
    const url = new URL(window.location.href);
    url.searchParams.set('node', node);
    window.history.replaceState(null, '', url);
  }, []);
  const choose = (next: WorkflowView) => {
    setView(next);
    writeAddress('view', next);
  };

  const node = graph.nodes.find((entry) => entry.id === selected);
  const condition = rule.conditions.find((entry) => entry.id === selected);
  const action = rule.actions.find((entry) => entry.id === selected);
  const checks = selected === 'diagnostics';
  const palette = paletteFor(rule.triggerKind, { connectedTools: toolChoices.length > 0 });
  // Full-size controls on a phone, where they are tapped rather than clicked.
  const size = desktop ? 'small' : 'default';
  const sheetProps = { organizationId, rule, statuses, templates, types, toolChoices, size } as const;

  const conditionAdd =
    mayManage && graph.semantics.conditions === 'all' ? (
      <AddConditionSheet organizationId={organizationId} rule={rule} statuses={statuses} definitions={definitions} types={types} size={size} />
    ) : null;
  const actionAdd = mayManage ? <AddActionSheet {...sheetProps} /> : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <AutomationState value={rule.enabled ? 'Enabled' : 'Disabled'} />
          <Button size={desktop ? 'tiny' : 'default'} tone="secondary" onClick={() => select('diagnostics')}>
            <ShieldCheck aria-hidden className="size-3.5" />
            {graph.issues.length ? `${graph.issues.length} to check` : 'Checks'}
          </Button>
          <ButtonLink size={desktop ? 'tiny' : 'default'} href={`${paths.runs}?when=all&rule=${rule.id}`}>
            <History aria-hidden className="size-3.5" /> History
          </ButtonLink>
        </div>
      </div>
      <h1 className={mayManage ? 'sr-only' : 'text-xl font-semibold tracking-tight'}>{rule.name}</h1>
      {mayManage ? (
        <RuleHeading organizationId={organizationId} rule={rule} />
      ) : (
        <p className="text-xs text-subtle">Your role can read this workflow but not change it.</p>
      )}

      {desktop ? (
        // The shared segmented toggle (as on Support and CRM home). Not `ViewModeSwitcher`: a
        // canvas and a step list are two drawings of one workflow, not collection layouts.
        <div role="group" aria-label="View" data-slot="tabs-list" data-variant="segmented" className={tabListStyles()}>
          {VIEWS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              data-slot="tabs-trigger"
              aria-pressed={view === value}
              onClick={() => choose(value)}
              className={tabTriggerStyles}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* The shared card is the one visual panel; the columns inside it are plain layout. */}
      <Card className="min-w-0 p-0">
        <div
          className={cx(
            'grid min-w-0 grid-cols-1',
            shown === 'canvas' && mayManage
              ? 'lg:grid-cols-[11rem_minmax(0,1fr)_22rem]'
              : 'lg:grid-cols-[minmax(0,1fr)_22rem]',
          )}
        >
        {shown === 'canvas' && mayManage ? (
          <nav aria-label="Add a step" className="hidden min-w-0 flex-col gap-2 border-r border-border p-3 lg:flex">
            {palette.map((entry) =>
              entry.role === 'condition' ? (
                <AddConditionSheet
                  key={entry.type}
                  organizationId={organizationId}
                  rule={rule}
                  statuses={statuses}
                  definitions={definitions}
                  types={types}
                  label={entry.label}
                />
              ) : (
                <AddActionSheet
                  key={entry.type}
                  {...sheetProps}
                  initialKind={entry.kind as AutomationRule['actions'][number]['kind']}
                  label={entry.label}
                />
              ),
            )}
          </nav>
        ) : null}

        <section
          aria-label="Workflow canvas"
          className={cx('min-w-0 bg-secondary', inspecting ? 'hidden lg:block' : '', shown === 'list' ? 'p-4 sm:p-6' : '')}
        >
          {shown === 'canvas' ? (
            <WorkflowCanvas graph={graph} selectedId={selected} onSelect={select} />
          ) : (
            <div className="mx-auto w-full max-w-xl">
              <WorkflowList graph={graph} selectedId={selected} onSelect={select} conditionAdd={conditionAdd} actionAdd={actionAdd} />
            </div>
          )}
        </section>

        <aside
          aria-label="Node inspector"
          className={cx('min-w-0 border-border lg:border-l', inspecting ? '' : 'hidden lg:block')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border p-4">
            <h2 className="text-sm font-semibold">
              {checks ? 'Checks' : node ? `${nodeHeading(node)} · ${node.label}` : 'Select a step'}
            </h2>
            <Button size="default" tone="text" className="lg:hidden" onClick={() => setInspecting(false)}>
              Back to steps
            </Button>
          </div>
          <div className="flex flex-col gap-4 p-4">
            {node?.issues.map((issue) => (
              <Alert key={issue.message} variant="destructive">
                <AlertTriangle aria-hidden />
                <AlertDescription className="text-current">{issue.message}</AlertDescription>
              </Alert>
            ))}

            {selected === 'trigger' && node ? (
              <>
                <p className="text-sm font-medium">{node.summary}</p>
                <p className="flex items-start gap-2 text-xs text-subtle">
                  <LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Fixed after creation, so past runs keep their meaning. Use a new workflow for a different trigger.
                </p>
                {rule.triggerKind === 'external_reading' || rule.triggerKind === 'counter_threshold' || rule.triggerKind === 'schedule' ? (
                  <p className="text-xs text-subtle">
                    {rule.triggerKind === 'external_reading'
                      ? 'Needs incoming readings in exactly this unit.'
                      : rule.triggerKind === 'schedule'
                        ? 'Runs once per scheduled job, counted from when the job starts.'
                        : 'Needs machine readings in this unit. The only action for a machine is Raise a job.'}
                  </p>
                ) : null}
                {mayManage ? <NewAutomationSheet organizationId={organizationId} /> : null}
              </>
            ) : null}

            {condition && node ? (
              <>
                {mayManage ? (
                  <div className="flex flex-wrap gap-2">
                    <AddConditionSheet
                      key={condition.id}
                      organizationId={organizationId}
                      rule={rule}
                      statuses={statuses}
                      definitions={definitions}
                      types={types}
                      condition={condition}
                      size={size}
                    />
                    <RemoveRuleNode organizationId={organizationId} ruleId={rule.id} nodeId={condition.id} kind="condition" size={size} />
                  </div>
                ) : null}
              </>
            ) : null}

            {action && node ? (
              <>
                <p className="text-sm">{node.summary}</p>
                {action.kind === 'run_tool' ? (
                  <p className="text-xs text-subtle">To change what it reads, remove it and add it again.</p>
                ) : null}
                {mayManage ? (
                  <div className="flex flex-wrap gap-2">
                    {node.operations.edit ? <AddActionSheet key={action.id} {...sheetProps} action={action} /> : null}
                    <RemoveRuleNode organizationId={organizationId} ruleId={rule.id} nodeId={action.id} kind="action" size={size} />
                  </div>
                ) : null}
              </>
            ) : null}

            {checks ? (
              <>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-subtle">Conditions</dt>
                    <dd>{graph.semantics.conditions === 'all' ? `${rule.conditions.length} · all must match` : 'None for a machine'}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Actions</dt>
                    <dd>{rule.actions.length} · in order</dd>
                  </div>
                </dl>
                {graph.issues.length ? (
                  <ItemGroup aria-label="Checks found">
                    {graph.issues.map((issue) => (
                      <Item key={`${issue.nodeId ?? 'workflow'}-${issue.message}`} size="sm" className="flex-nowrap items-start px-0 text-xs">
                        <ItemMedia className={issue.severity === 'error' ? 'text-danger' : 'text-warning'}>
                          <AlertTriangle aria-hidden className="size-3.5" />
                        </ItemMedia>
                        <ItemContent>
                          <span className={issue.severity === 'error' ? 'text-danger' : undefined}>
                            {issue.severity === 'error' ? 'Error: ' : 'Warning: '}
                            {issue.message}
                          </span>
                        </ItemContent>
                      </Item>
                    ))}
                  </ItemGroup>
                ) : (
                  <p className="flex items-center gap-2 text-xs">
                    <CircleCheck aria-hidden className="size-3.5 shrink-0 text-success" />
                    No problems found.
                  </p>
                )}
                {rule.enabled ? null : (
                  <p className="text-xs text-subtle">Once switched on, actions can change live work and message customers.</p>
                )}
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold">Recent runs</h3>
                  {recentRuns.length ? (
                    <ul className="divide-y divide-border text-xs">
                      {recentRuns.map((run) => (
                        <li key={run.id} className="flex flex-col gap-1 py-2">
                          <span className="flex items-center justify-between gap-2">
                            <Link href={`${paths.runs}?when=all&run=${run.id}`} className="text-accent-text hover:underline">
                              {automationTime(run.occurredAt, timezone)}
                            </Link>
                            <AutomationState value={run.outcome} />
                          </span>
                          {run.outcome === 'failed' ? <span className="text-subtle">{automationDiagnostic(run.detail)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-subtle">Not run yet.</p>
                  )}
                  <ButtonLink size="small" href={`${paths.runs}?when=all&rule=${rule.id}`} className="w-fit">
                    All runs
                  </ButtonLink>
                </div>
              </>
            ) : null}

            {!node && !checks ? <p className="text-xs text-subtle">That step no longer exists.</p> : null}
          </div>
        </aside>
        </div>
      </Card>
    </div>
  );
}
