'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextArea } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/containers/section';
import {
  DISCOVERY_SNAPSHOT_CATEGORIES,
  DISCOVERY_SNAPSHOT_CATEGORY_LABELS,
  discoverySnapshotCompleteness,
  type DiscoverySnapshot,
} from '@/lib/domain/customers/discovery-snapshots';
import {
  editDiscoverySnapshotAction,
  type EditDiscoverySnapshotState,
} from '@/app/organizations/[organizationId]/customers/[customerId]/actions';

const EDIT_INITIAL: EditDiscoverySnapshotState = { error: null, updated: false };

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
        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="customerId" value={customerId} />

          {DISCOVERY_SNAPSHOT_CATEGORIES.map((category) => (
            <div key={category} className="flex flex-col gap-1">
              <FieldLabel htmlFor={category}>{DISCOVERY_SNAPSHOT_CATEGORY_LABELS[category]}</FieldLabel>
              <TextArea
                id={category}
                name={category}
                defaultValue={snapshot?.answers[category] ?? ''}
                rows={2}
              />
            </div>
          ))}

          <Button type="submit" disabled={pending} className="w-fit">
            Save
          </Button>

          {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {DISCOVERY_SNAPSHOT_CATEGORIES.filter((category) => snapshot?.answers[category]).map((category) => (
            <div key={category} className="flex flex-col gap-1">
              <FieldLabel>{DISCOVERY_SNAPSHOT_CATEGORY_LABELS[category]}</FieldLabel>
              <p className="text-sm">{snapshot!.answers[category]}</p>
            </div>
          ))}
          {answered === 0 ? <Hint>Nothing recorded yet.</Hint> : null}
          <Hint className="mt-2">Your role, {role}, cannot change this customer.</Hint>
        </div>
      )}
    </Section>
  );
}
