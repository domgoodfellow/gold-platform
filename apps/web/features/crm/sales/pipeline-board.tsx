import type { ReactNode } from 'react';
import { Building2, CircleHelp, User } from 'lucide-react';
import { Board, BoardCard, BoardColumn } from '@/components/patterns/board';
import { EntityIdentity } from '@/components/display/entity-row';

export type PipelinePerson = { id: string; name: string; contactType?: 'person' | 'company' | 'unspecified' };
const IDENTITY = { person: { Icon: User, label: 'Person' }, company: { Icon: Building2, label: 'Company' }, unspecified: { Icon: CircleHelp, label: 'Needs classification' } } as const;
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
  customers: { id: string; name: string; stageId: string | null; contactType?: PipelinePerson['contactType'] }[],
): PipelineColumn[] {
  const perStage = new Map<string, PipelinePerson[]>();
  for (const customer of customers) {
    // Null is ordinary — a business that has named no stages, or a customer nobody has staged
    // yet. Both are "this business has said nothing", never "something is missing".
    const key = customer.stageId ?? '';
    perStage.set(key, [...(perStage.get(key) ?? []), { id: customer.id, name: customer.name, contactType: customer.contactType }]);
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
 * but must not define it — the same one-owner rule ADR-008 states for business facts applies
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
    <Board label="Relationship stages">
      {columns.map((column) => (
        <BoardColumn key={column.key || 'unstaged'} name={column.name} count={column.people.length} empty="No contacts on this stage.">
          {column.people.length ? column.people.map((person) => {
            const identity = IDENTITY[person.contactType ?? 'unspecified'] ?? IDENTITY.unspecified;
            return <BoardCard key={person.id} actions={renderStageControl ? renderStageControl(person) : undefined}>
              <EntityIdentity icon={identity.Icon} kind={identity.label} name={person.name} href={customerHref(person.id)} secondary={identity.label} />
            </BoardCard>;
          }) : null}
        </BoardColumn>
      ))}
    </Board>
  );
}
