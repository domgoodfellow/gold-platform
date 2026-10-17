'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { ErrorText, FieldLabel, Hint, TextArea } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import {
  discoverySnapshotCompleteness,
  unresolvedDiscoveryRequirements,
  type DiscoveryAnswer,
  type DiscoverySnapshot,
} from '@/lib/domain/customers/discovery-snapshots';
import {
  DISCOVERY_REQUIREMENTS,
  discoveryRequirement,
  type DiscoveryRequirement,
  type DiscoveryRequirementKey,
} from '@/lib/domain/customers/discovery-requirements';
import {
  editDiscoverySnapshotAction,
  type EditDiscoverySnapshotState,
} from '@/app/organizations/[organizationId]/customers/[customerId]/actions';

const EDIT_INITIAL: EditDiscoverySnapshotState = { error: null, updated: false };

const STATUS_LABEL: Record<DiscoveryAnswer['status'], string> = {
  provided: 'Provided',
  confirmed: 'Confirmed',
  not_applicable: 'Not applicable',
};

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
 * or what any business using this screen has learned about theirs. Editable as one form
 * rather than field-by-field, because a discovery conversation is written up in one sitting, not
 * corrected one line at a time — the shape a salesperson running this during a call needs.
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
  const [notApplicable, setNotApplicable] = useState<ReadonlySet<DiscoveryRequirementKey>>(
    () => new Set(DISCOVERY_REQUIREMENTS.filter((r) => snapshot?.answers[r.key]?.status === 'not_applicable').map((r) => r.key)),
  );
  const { answered, total } = discoverySnapshotCompleteness({ answers: snapshot?.answers ?? {} });
  const unresolved = unresolvedDiscoveryRequirements({ answers: snapshot?.answers ?? {} });

  function toggleNotApplicable(key: DiscoveryRequirementKey, checked: boolean) {
    setNotApplicable((prior) => {
      const next = new Set(prior);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <Section>
      <SectionHeading>Discovery</SectionHeading>
      <Hint className="mt-1">
        {answered} of {total} answered.
      </Hint>
      {unresolved.length > 0 ? (
        <Hint weight="subtle" className="mt-1">
          Not yet asked: {unresolved.map((requirement) => requirement.question).join(' · ')}
        </Hint>
      ) : null}

      {mayEdit ? (
        <form action={formAction} className="mt-4 flex flex-col gap-6">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="customerId" value={customerId} />

          {groupedRequirements().map(([category, requirements]) => (
            <div key={category} className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">{category}</h3>
              {requirements.map((requirement) => {
                const answer = snapshot?.answers[requirement.key];
                const na = notApplicable.has(requirement.key);
                return (
                  <div key={requirement.key} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldLabel htmlFor={requirement.key}>{requirement.question}</FieldLabel>
                      {answer ? <Badge tone={answer.status === 'not_applicable' ? 'neutral' : answer.status === 'confirmed' ? 'success' : 'neutral'}>{STATUS_LABEL[answer.status]}</Badge> : null}
                      {answer ? <Hint weight="subtle">via {answer.source}</Hint> : null}
                    </div>
                    {requirement.dependsOn ? (
                      <Hint weight="subtle">
                        Usually answered after &ldquo;{discoveryRequirement(requirement.dependsOn).question}&rdquo;
                      </Hint>
                    ) : null}
                    <TextArea
                      id={requirement.key}
                      name={requirement.key}
                      defaultValue={answer?.status === 'not_applicable' ? '' : (answer?.value ?? '')}
                      disabled={na}
                      rows={2}
                    />
                    <label className="flex items-center gap-2 text-sm text-muted">
                      <input
                        type="checkbox"
                        name={`${requirement.key}__na`}
                        defaultChecked={na}
                        onChange={(event) => toggleNotApplicable(requirement.key, event.target.checked)}
                      />
                      Not applicable
                    </label>
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
          {DISCOVERY_REQUIREMENTS.filter((requirement) => snapshot?.answers[requirement.key]).map((requirement) => {
            const answer = snapshot!.answers[requirement.key]!;
            return (
              <div key={requirement.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FieldLabel>{requirement.question}</FieldLabel>
                  <Badge tone={answer.status === 'confirmed' ? 'success' : 'neutral'}>{STATUS_LABEL[answer.status]}</Badge>
                  <Hint weight="subtle">via {answer.source}</Hint>
                </div>
                {answer.status === 'not_applicable' ? null : <p className="text-sm">{answer.value}</p>}
              </div>
            );
          })}
          {answered === 0 ? <Hint>Nothing recorded yet.</Hint> : null}
          <Hint className="mt-2">Your role, {role}, cannot change this customer.</Hint>
        </div>
      )}
    </Section>
  );
}
