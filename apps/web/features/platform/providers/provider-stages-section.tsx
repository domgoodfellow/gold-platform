import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { CREDENTIAL_LABEL, type ProviderStages } from '@/lib/domain/providers/stages';

/**
 * The six separate facts behind a provider's status, in the order they must hold. A catalogue row
 * is the first and says nothing about the rest, so this is what stops *catalogued* reading as
 * *working*: each line is answered on its own, and the last is only true when every applicable one is.
 */
export function ProviderStagesSection({ stages }: { stages: ProviderStages }) {
  return (
    <Section>
      <SectionHeading>Readiness</SectionHeading>
      <DefinitionList className="mt-3">
        <Detail label="Catalogued">Yes</Detail>
        <Detail label="Account can be set up">
          {stages.accountAdapter ? 'Yes' : <span className="text-muted">No — nothing in GildOps can use an account for this vendor yet</span>}
        </Detail>
        <Detail label="Credential">
          {stages.accountAdapter ? (
            <Badge tone={stages.credential === 'verified' || stages.credential === 'deployment' ? 'success' : stages.credential === 'failed' ? 'danger' : 'neutral'}>
              {CREDENTIAL_LABEL[stages.credential]}
            </Badge>
          ) : (
            '—'
          )}
        </Detail>
        <Detail label="Service implemented">
          {stages.implemented.catalogued === 0
            ? 'No services catalogued'
            : `${stages.implemented.available} of ${stages.implemented.catalogued} catalogued services`}
        </Detail>
        <Detail label="AI answering assigned">
          {!stages.runtime.applicable ? '—' : stages.runtime.assigned > 0 ? `${stages.runtime.assigned} capabilit${stages.runtime.assigned === 1 ? 'y' : 'ies'}` : 'Not assigned'}
        </Detail>
        <Detail label="Operational">
          <Badge tone={stages.operational ? 'success' : 'neutral'}>{stages.operational ? 'Operational' : 'Not operational'}</Badge>
          {stages.blocker ? <span className="ml-2 text-sm text-muted">{stages.blocker}</span> : null}
        </Detail>
      </DefinitionList>
    </Section>
  );
}
