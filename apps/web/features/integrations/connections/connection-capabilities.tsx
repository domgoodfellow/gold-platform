import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DividedList, Section, SectionHeading } from '@/components/surfaces/section';
import { GrantForm, RevokeGrantForm } from '@/features/integrations/mcp/mcp-controls';
import type { IntegrationResource } from '@/lib/domain/integrations/resources';
import type { Agent, NativeCapability, ToolGrant } from '@/lib/domain/integrations/tool-access';

const WORKSPACE_LABEL: Record<string, string> = {
  crm: 'CRM',
  communications: 'Communications',
  marketing: 'Marketing',
  support: 'Support',
  finance: 'Finance',
  field: 'Field',
  studio: 'Studio',
  library: 'Library',
};

/**
 * What this connection can be used for, and who has been given each use. A connection grants nothing
 * by itself: every use below is off until someone with access to integrations gives it to the agent,
 * and every one only reads. The agent asks for it where it is asked questions; this is where the
 * business decides.
 */
export function ConnectionCapabilities({
  organizationId,
  connectionId,
  capabilities,
  grants,
  agents,
  resources,
}: {
  organizationId: string;
  connectionId: string;
  capabilities: NativeCapability[];
  grants: ToolGrant[];
  agents: Agent[];
  resources: IntegrationResource[];
}) {
  if (capabilities.length === 0) return null;
  const agentName = new Map(agents.map((agent) => [agent.id, agent.name]));
  const resourceName = new Map(resources.map((resource) => [resource.id, resource.displayName]));

  return (
    <Section className="mt-8">
      <SectionHeading>What an agent can do with this</SectionHeading>
      <DividedList className="mt-3">
        {capabilities.map((capability) => {
          const given = grants.filter((grant) => grant.capabilityKey === capability.key);
          const matching = capability.resourceType
            ? resources
                .filter((resource) => resource.resourceType === capability.resourceType && resource.status === 'active')
                .map((resource) => ({ id: resource.id, label: resource.displayName }))
            : [];
          return (
            <li key={capability.key} className="flex flex-col gap-2 py-3">
              <div>
                <p className="font-medium">{capability.summary}</p>
                <p className="text-sm text-muted">
                  {WORKSPACE_LABEL[capability.workspace] ? `Used in ${WORKSPACE_LABEL[capability.workspace]}.` : null}
                </p>
              </div>
              {given.length > 0 ? (
                <ul className="flex flex-col gap-1" aria-label={`Who can use: ${capability.summary}`}>
                  {given.map((grant) => (
                    <li key={grant.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone="success">{agentName.get(grant.agentId) ?? 'An agent'}</Badge>
                      <span className="text-muted">
                        {grant.resourceId ? `only ${resourceName.get(grant.resourceId) ?? 'one item'}` : 'everything it can reach'}
                        {grant.requiresApproval ? ', a person approves each use' : ''}
                      </span>
                      <RevokeGrantForm
                        organizationId={organizationId}
                        grantId={grant.id}
                        connectionId={connectionId}
                        agentName={agentName.get(grant.agentId) ?? 'agent'}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              <GrantForm
                organizationId={organizationId}
                agents={agents.filter((agent) => !given.some((grant) => grant.agentId === agent.id && grant.resourceId === null))}
                target={{ connectionId, capabilityKey: capability.key }}
                resources={matching}
                everyAgentHasIt={agents.length > 0 && agents.every((agent) => given.some((grant) => grant.agentId === agent.id && grant.resourceId === null))}
              />
            </li>
          );
        })}
      </DividedList>
      <Hint className="mt-2 max-w-2xl">
        Connecting does not let the agent use any of this. Give it each use you want. These only read from the app; none of them changes anything in it.
      </Hint>
    </Section>
  );
}
