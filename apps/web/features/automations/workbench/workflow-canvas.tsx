'use client';

import '@xyflow/react/dist/style.css';
import { useMemo, type CSSProperties } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { WorkflowNode } from '@/lib/domain/automation/workflow-graph';
import type { WorkflowRendererProps } from './renderer';
import { WorkflowStepCard } from './step-card';

type StepData = {
  node: WorkflowNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
};

/**
 * One step on the canvas: the shared step card, so the canvas and the step list cannot disagree.
 * A real button, so the canvas is usable by keyboard and screen reader without React Flow's own
 * node focus; its handles exist only to anchor the computed edges and accept no connection.
 */
function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { node, selected, onSelect } = data;
  return (
    <WorkflowStepCard node={node} selected={selected} onSelect={onSelect} className="w-72">
      <Handle type="target" position={Position.Top} isConnectable={false} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!opacity-0" />
    </WorkflowStepCard>
  );
}

const nodeTypes = { step: StepNode };

// React Flow's own variables, pointed at the theme's tokens so Appearance and dark mode apply.
const THEME = {
  '--xy-background-color': 'var(--secondary)',
  '--xy-background-pattern-color': 'var(--border)',
  '--xy-edge-stroke': 'var(--subtle)',
  '--xy-edge-label-background-color': 'var(--secondary)',
  '--xy-edge-label-color': 'var(--subtle)',
  '--xy-controls-button-background-color': 'var(--background)',
  '--xy-controls-button-background-color-hover': 'var(--secondary)',
  '--xy-controls-button-color': 'var(--foreground)',
  '--xy-controls-button-border-color': 'var(--border)',
  '--xy-attribution-background-color': 'transparent',
} as CSSProperties;

/**
 * The 2D canvas renderer. Pan and zoom, select a step; nothing is dragged or connected, because
 * the runtime has one fixed order and no branches — a connection a person drew would be a graph
 * nothing can run.
 */
export default function WorkflowCanvas({ graph, selectedId, onSelect }: WorkflowRendererProps) {
  const nodes = useMemo<Node<StepData>[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'step',
        position: node.layout,
        data: { node, selected: node.id === selectedId, onSelect },
        draggable: false,
        connectable: false,
        selectable: false,
      })),
    [graph.nodes, selectedId, onSelect],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'straight',
        label: edge.kind,
        markerEnd: { type: MarkerType.ArrowClosed },
        focusable: false,
        selectable: false,
      })),
    [graph.edges],
  );

  return (
    <div className="h-144 w-full" style={THEME}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        // A node that can be neither dragged nor selected ignores the pointer unless the canvas
        // listens for clicks on it; the step's own button then receives the click.
        onNodeClick={(_, clicked) => onSelect(clicked.id)}
        zoomOnScroll={false}
        preventScrolling={false}
      >
        <Background gap={20} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
