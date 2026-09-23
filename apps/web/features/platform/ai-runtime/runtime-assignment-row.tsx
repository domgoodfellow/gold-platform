import { Badge, DefinitionList, Detail } from '@/components/display/data';
import type { AiCapability, AiRuntimeAssignment } from '@/lib/domain/ai/runtime';
import { RuntimeAssignmentDrawer } from './runtime-assignment-drawer';
import type { RuntimeAccount, RuntimeService } from './runtime-assignment-form';

/**
 * One capability, whether or not it currently has an assignment. An unassigned row is not an
 * error state — `app.ai.runtime` falls back to the deployment default exactly as it did before
 * this screen existed (D31's reasoning, restated for a runtime rather than a whole feature).
 */
export function RuntimeAssignmentRow({
  capability,
  label,
  assignment,
  services,
  accounts,
}: {
  capability: AiCapability;
  label: string;
  assignment: AiRuntimeAssignment | undefined;
  services: RuntimeService[];
  accounts: RuntimeAccount[];
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        {assignment ? (
          <DefinitionList className="mt-1">
            <Detail label="Service">{assignment.providerServiceLabel}</Detail>
            <Detail label="Model">{assignment.model}</Detail>
            <Detail label="Account">{assignment.providerAccountLabel}</Detail>
          </DefinitionList>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Not assigned — answers using this deployment&apos;s default configuration.
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {assignment ? <Badge tone="success">Assigned</Badge> : <Badge tone="neutral">Deployment default</Badge>}
        <RuntimeAssignmentDrawer
          capability={capability}
          label={`${assignment ? 'Change' : 'Assign'} ${label}`}
          services={services}
          accounts={accounts}
          current={
            assignment
              ? { providerServiceId: assignment.providerServiceId, providerAccountId: assignment.providerAccountId, model: assignment.model }
              : undefined
          }
          triggerLabel={assignment ? 'Change' : 'Assign'}
        />
      </div>
    </li>
  );
}
