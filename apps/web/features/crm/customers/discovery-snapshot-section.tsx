'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { ErrorText, FieldLabel, Hint, TextArea } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/containers/section';
import {
  discoverySnapshotCompleteness,
  type DiscoverySnapshot,
} from '@/lib/domain/customers/discovery-snapshots';
import {
  DISCOVERY_REQUIREMENTS,
  discoveryRequirement,
  type DiscoveryRequirement,
} from '@/lib/domain/customers/discovery-requirements';
import {
  editDiscoverySnapshotAction,
  type EditDiscoverySnapshotState,
} from '@/app/organizations/[organizationId]/customers/[customerId]/actions';

const EDIT_INITIAL: EditDiscoverySnapshotState = { error: null, updated: false };

/** Catalogue order, grouped by category — the grouping is display only, never a second copy of the catalogue. */
function groupedRequirements(): [string, DiscoveryRequirement[]][] {
  const groups = new Map<string, DiscoveryRequirement[]>();
  for (const requirement of DISCOVERY_REQUIREMENTS) {
    const group = groups.get(requirement.category) ?? [];
    group.push(requirement);
    groups.set(requirement.category, group);
  }
  return [...groups.entries()];
}

/**
 * What GildOps has learned about this customer before they have their own organization —
 * or what any business using this screen has learned about theirs (I61). Editable as one form
 * rather than field-by-field, because a discovery conversation is written up in one sitting, not
 * corrected one line at a time.
 */
export function DiscoverySnapshotSection({
  organizationId,
  customerId,
  snapshot,
  mayEdit,
  role,
}: {
  organizationId: string;
  customerId: string;
  snapshot: DiscoverySnapshot | null;
  mayEdit: boolean;
  role: string;
}) {
  const [state, formAction, pending] = useActionState(editDiscoverySnapshotAction, EDIT_INITIAL);
  const { answered, total } = discoverySnapshotCompleteness({ answers: snapshot?.answers ?? {} });

  return (
    <Section>
      <SectionHeading>Discovery</SectionHeading>
      <Hint className="mt-1">
        {answered} of {total} answered.
      </Hint>

      {mayEdit ? (
        <form action={formAction} className="mt-4 flex flex-col gap-6">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="customerId" value={customerId} />

          {groupedRequirements().map(([category, requirements]) => (
            <div key={category} className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">{category}</h3>
              {requirements.map((requirement) => {
                const answer = snapshot?.answers[requirement.key];
                return (
                  <div key={requirement.key} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <FieldLabel htmlFor={requirement.key}>{requirement.question}</FieldLabel>
                      {answer ? (
                        <Badge tone={answer.status === 'confirmed' ? 'success' : 'neutral'}>
                          {answer.status === 'confirmed' ? 'Confirmed' : 'Provided'}
                        </Badge>
                      ) : null}
                    </div>
                    {requirement.dependsOn ? (
                      <Hint weight="subtle">
                        Usually answered after &ldquo;{discoveryRequirement(requirement.dependsOn).question}&rdquo;
                      </Hint>
                    ) : null}
                    <TextArea
                      id={requirement.key}
                      name={requirement.key}
                      defaultValue={answer?.value ?? ''}
                      rows={2}
                    />
                  </div>
                );
              })}
            </div>
          ))}

          <Button type="submit" disabled={pending} className="w-fit">
            Save
          </Button>

          {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {DISCOVERY_REQUIREMENTS.filter((requirement) => snapshot?.answers[requirement.key]?.value).map(
            (requirement) => {
              const answer = snapshot!.answers[requirement.key]!;
              return (
                <div key={requirement.key} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <FieldLabel>{requirement.question}</FieldLabel>
                    <Badge tone={answer.status === 'confirmed' ? 'success' : 'neutral'}>
                      {answer.status === 'confirmed' ? 'Confirmed' : 'Provided'}
                    </Badge>
                  </div>
                  <p className="text-sm">{answer.value}</p>
                </div>
              );
            },
          )}
          {answered === 0 ? <Hint>Nothing recorded yet.</Hint> : null}
          <Hint className="mt-2">Your role, {role}, cannot change this customer.</Hint>
        </div>
      )}
    </Section>
  );
}
