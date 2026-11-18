import type { WorkflowGraph, WorkflowNode } from '@/lib/domain/automation/workflow-graph';

/**
 * The boundary every workflow renderer sits behind.
 *
 * A renderer draws one `WorkflowGraph` and reports which node a person chose. It owns no data,
 * calls no command and keeps no copy of the graph: the workbench owns selection and the inspector,
 * and every change goes through the existing rule commands and comes back as a new projection.
 * The canvas and the step list are the two renderers today. A later spatial renderer (Three.js)
 * implements the same props and needs nothing else from the workbench.
 */
export type WorkflowRendererProps = {
  graph: WorkflowGraph;
  selectedId: string;
  onSelect: (nodeId: string) => void;
};

export type WorkflowView = 'canvas' | 'list';

export function nodeHeading(node: WorkflowNode): string {
  if (node.role === 'trigger') return 'Trigger';
  if (node.role === 'condition') return `Condition ${node.index}`;
  return `Action ${node.index}`;
}
