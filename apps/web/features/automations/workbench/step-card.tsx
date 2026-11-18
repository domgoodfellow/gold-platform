'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Filter, Workflow, Zap } from 'lucide-react';
import { SelectableCard } from '@/components/controls/selectable-card';
import { cx } from '@/components/class-names';
import type { WorkflowNode } from '@/lib/domain/automation/workflow-graph';
import { nodeHeading } from './renderer';

const ICONS = { trigger: Zap, condition: Filter, action: Workflow } as const;

/**
 * One step, as both renderers draw it: the shared selectable card, the step's kind as its icon,
 * and its title and summary from the projection. The position ("Action 1") is part of the
 * button's name for assistive technology; on screen the group headings and the canvas's
 * "if / and / then" edges already say it.
 */
export function WorkflowStepCard({
  node,
  selected,
  onSelect,
  className,
  children,
}: {
  node: WorkflowNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  className?: string;
  /** Trailing decoration or connector anchors; never another control. */
  children?: ReactNode;
}) {
  const Icon = ICONS[node.role];
  return (
    <SelectableCard
      selected={selected}
      onClick={() => onSelect(node.id)}
      className={cx('min-h-11 flex-row items-start justify-start gap-3 p-3', className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">
          <span className="sr-only">{nodeHeading(node)}:</span>{' '}
          {node.label}
        </span>
        {node.summary ? <span className="text-xs font-normal text-subtle">{node.summary}</span> : null}
        {node.issues.length ? (
          <span className="mt-1 flex items-center gap-1 text-xs font-normal text-danger">
            <AlertTriangle aria-hidden className="size-3.5" /> Needs attention
          </span>
        ) : null}
      </span>
      {children}
    </SelectableCard>
  );
}
