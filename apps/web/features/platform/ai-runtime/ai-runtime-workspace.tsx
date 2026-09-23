import { Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { AI_CAPABILITIES, AI_CAPABILITY_LABEL, type AiRuntimeAssignment } from '@/lib/domain/ai/runtime';
import { RuntimeAssignmentRow } from './runtime-assignment-row';
import type { RuntimeAccount, RuntimeService } from './runtime-assignment-form';

/**
 * The one authoritative surface for AI runtime policy — assignments are never edited from a
 * Provider's own page (which only summarises and links back here), so there is one place a person
 * checks to know what answers a capability, not a copy per provider.
 */
export function AiRuntimeWorkspace({
  assignments,
  services,
  accounts,
}: {
  assignments: AiRuntimeAssignment[];
  services: RuntimeService[];
  accounts: RuntimeAccount[];
}) {
  const byCapability = new Map(assignments.map((assignment) => [assignment.capability, assignment]));

  return (
    <div className="flex flex-col gap-6">
      <Section>
        <SectionHeading>Assignments</SectionHeading>
        <ul className="mt-2 flex flex-col divide-y divide-border">
          {AI_CAPABILITIES.map((capability) => (
            <RuntimeAssignmentRow
              key={capability}
              capability={capability}
              label={AI_CAPABILITY_LABEL[capability]}
              assignment={byCapability.get(capability)}
              services={services}
              accounts={accounts}
            />
          ))}
        </ul>
      </Section>

      <Section>
        <SectionHeading>Configuration drafting</SectionHeading>
        <div className="mt-2 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Anthropic</p>
            <Hint>Deployment-backed. Not yet managed here — it reads its own credential from this deployment&apos;s environment.</Hint>
          </div>
        </div>
      </Section>
    </div>
  );
}
