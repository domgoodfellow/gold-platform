'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { GroupHeading } from '@/components/surfaces/section';
import type { WorkflowNode } from '@/lib/domain/automation/workflow-graph';
import type { WorkflowRendererProps } from './renderer';
import { WorkflowStepCard } from './step-card';

/**
 * The step renderer: the same graph as the canvas, read top to bottom. The default on a phone,
 * and a choice on a wide screen. Groups say how the runtime reads them — every condition must
 * hold, and actions run in the order shown.
 */
export function WorkflowList({
  graph,
  selectedId,
  onSelect,
  conditionAdd,
  actionAdd,
}: WorkflowRendererProps & { conditionAdd?: ReactNode; actionAdd?: ReactNode }) {
  const trigger = graph.nodes.filter((node) => node.role === 'trigger');
  const conditions = graph.nodes.filter((node) => node.role === 'condition');
  const actions = graph.nodes.filter((node) => node.role === 'action');
  const step = (node: WorkflowNode) => (
    <li key={node.id}>
      <WorkflowStepCard node={node} selected={selectedId === node.id} onSelect={onSelect}>
        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" />
      </WorkflowStepCard>
    </li>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <GroupHeading>When</GroupHeading>
        <ol className="flex flex-col gap-2" aria-label="Trigger">
          {trigger.map(step)}
        </ol>
      </div>
      <div className="flex flex-col gap-2">
        <GroupHeading>
          {graph.semantics.conditions === 'all' ? 'If all of these match' : 'Conditions'}
        </GroupHeading>
        {graph.semantics.conditions === 'not_applicable' ? (
          <p className="text-xs text-subtle">A machine counter has no job to check.</p>
        ) : conditions.length ? (
          <ol className="flex flex-col gap-2">{conditions.map(step)}</ol>
        ) : (
          <p className="text-xs text-subtle">No conditions. Every trigger qualifies.</p>
        )}
        {conditionAdd}
      </div>
      <div className="flex flex-col gap-2">
        <GroupHeading>Then, in order</GroupHeading>
        {actions.length ? (
          <ol className="flex flex-col gap-2">{actions.map(step)}</ol>
        ) : (
          <p className="text-xs text-subtle">No actions yet. Nothing happens until one is added.</p>
        )}
        {actionAdd}
      </div>
    </div>
  );
}
