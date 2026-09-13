import type { ReactNode } from 'react';
import Link from 'next/link';
import { EmptyState, GroupHeading } from '@/components/containers/section';

export type PipelinePerson = { id: string; name: string };
export type PipelineColumn = { key: string; name: string; people: PipelinePerson[] };

/**
 * Group customers into pipeline columns.
 *
 * **The one place this grouping happens.** `apps/web/app/organizations/[organizationId]/calls`
 * used to build this same structure inline for its own pipeline summary; a second copy is how a
 * summary and the canonical board eventually disagree about who is in which column.
 */
export function buildPipelineColumns(
  stages: { id: string; name: string }[],
  customers: { id: string; name: string; stageId: string | null }[],
): PipelineColumn[] {
  const perStage = new Map<string, PipelinePerson[]>();
  for (const customer of customers) {
    // Null is ordinary — a business that has named no stages, or a customer nobody has staged
    // yet. Both are "this business has said nothing", never "something is missing".
    const key = customer.stageId ?? '';
    perStage.set(key, [...(perStage.get(key) ?? []), { id: customer.id, name: customer.name }]);
  }

  return [
    ...stages.map((stage) => ({
      key: stage.id,
      name: stage.name,
      people: perStage.get(stage.id) ?? [],
    })),
    // Last, and only when somebody is in it. A business that has staged everybody never sees
    // this column at all.
    ...((perStage.get('') ?? []).length > 0
      ? [{ key: '', name: 'No stage', people: perStage.get('') ?? [] }]
      : []),
  ];
}

/**
 * The pipeline, read as a board.
 *
 * **CRM/Sales owns this component.** Communications/Voice consumes it for a calls-page summary
 * but must not define it — the same rule `constraints.md` states for navigation sections applies
 * to the component itself: `reception` is a shared runtime module underneath both catalogue
 * Products, and this is CRM's own reading of it.
 *
 * **A card carries a stage control only when `renderStageControl` is given.** The canonical page
 * (`customers/pipeline`) supplies one; a summary consumer omits it and gets the same read-only
 * board this used to be everywhere.
 *
 * Scrolls sideways rather than wrapping, because columns that reflow stop reading as a pipeline.
 */
export function PipelineBoard({
  columns,
  customerHref,
  renderStageControl,
}: {
  columns: PipelineColumn[];
  customerHref: (id: string) => string;
  renderStageControl?: (person: PipelinePerson) => ReactNode;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((column) => (
        <section
          key={column.key || 'unstaged'}
          className="flex w-60 shrink-0 flex-col rounded border border-border"
        >
          <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
            <GroupHeading>{column.name}</GroupHeading>
            <span className="text-sm tabular-nums text-muted">{column.people.length}</span>
          </div>
          {column.people.length === 0 ? (
            <EmptyState weight="subtle" className="px-3 py-2">
              Nobody here.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {column.people.map((person) => (
                <li key={person.id} className="px-3 py-2">
                  <Link
                    href={customerHref(person.id)}
                    className="block truncate text-sm underline-offset-4 hover:underline"
                  >
                    {person.name}
                  </Link>
                  {renderStageControl ? renderStageControl(person) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
