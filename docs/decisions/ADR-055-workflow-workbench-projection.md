# ADR-055 — The workflow workbench draws stored rules; GildOps' own automated work is listed apart

**Recorded:** 2026-11-17
**Status:** Accepted
**Origin:** Owner work order "GildOps Automations: Visual Workflow Workbench and Existing Automation Discovery".

## Context

Automations needed a visual editor. Two attractive designs would have caused harm:

- A new workflow document (nodes, edges, positions) saved beside the rule tables would be a second executable copy of every rule. It could disagree with `automation_rules`, `automation_conditions` and `automation_actions`, which `app.run_automation` actually runs.
- A free-form canvas lets a person draw branches and connections the rule engine cannot run: it has one trigger, conditions that must all hold and actions in a fixed order.

Separately, a business with no rules saw an empty Automations workspace even though GildOps already does automated work for it (sending workflow messages, timed checks, connected tool calls, source synchronization, service update emails).

## Decision

1. **The graph is a projection.** A workflow is drawn from its stored rule rows by `projectRule` (`lib/domain/automation/workflow-graph.ts`). Every node carries the id of its row; edits go through the existing rule commands; nothing about the graph is stored. Layout is computed from step order. ADR-019 stands: `app.run_automation` remains the only engine.
2. **Edges are computed, not drawn.** Trigger, then conditions joined by "and", then actions in order. The canvas offers no dragging or connecting; the trigger is shown as fixed.
3. **One node registry.** `workflow-nodes.ts` mirrors the rule vocabulary. Incoming webhooks, HTTP requests, AI agent steps and branches are registered as planned so a later engine has a place to land, but are never offered, drawn or stored.
4. **One renderer contract.** The canvas (React Flow) and the step list render the same graph; a phone gets the step list. A later spatial (Three.js) renderer implements the same contract.
5. **Managed automations are listed, not modelled.** `lib/domain/automation/managed.ts` names automated work GildOps already performs for a business, the workspace that owns it and where its settings and records live. Entries are shown under Workflows only when the business has the matching feature, and are never editable as workflows. The schedulers and outside callbacks behind them are listed only to platform staff (Platform → Failures).
6. **Navigation.** Automations is Dashboard, Workflows, Runs and Message templates. The former Rules and Activity addresses, and the old rule address, redirect.

## Consequences

- Canvas, step list and reload always agree, because all three read the stored rows.
- No migration was needed; hosted data is unaffected.
- Branching, reordering, webhook triggers and outgoing HTTP actions require a separately approved engine and storage change. When one exists it produces the same graph shape, and the renderers do not change.

## Rejected alternatives

- A stored workflow document beside the rule tables (a second source of truth).
- A free-form canvas with drag-to-connect (graphs the engine cannot run).
- Seeding example rules or showing placeholder workflows to fill an empty workspace.
- Showing schedulers and outside callbacks to businesses.

## Enforcement / current owners

- `docs/product.md` → Automations
- `docs/architecture.md` → Automation architecture
- `apps/web/tests/unit/workflow-graph.test.ts`, `apps/web/tests/component/workflow-workbench.test.tsx`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
