'use client';

import { useMemo } from 'react';
import { useAgentContent } from '@/components/containers/workspace-right-rail';
import { AgentEmptyConversation, AgentPanelFrame, AgentUnavailable } from './agent-shared';

/**
 * Registers the Agent rail's content for Platform scope. Its own component, not the tenant one
 * pointed at a stand-in organization (rule 13 of the shell/context correction) — no
 * `organizationId` prop exists here at all, and no conversation, composer or answering action is
 * reachable from it. Answering capability comes from `canAnswerPlatformQuestions`, which is
 * honestly `false` until a platform-scoped answering endpoint exists (see that function's own
 * comment) — so this renders the real "Agent unavailable" surface, pointed at
 * `/platform/providers`, rather than a composer with nothing behind it.
 *
 * `canAnswer` comes from `canAnswerPlatformQuestions()`, read in `platform/layout.tsx` exactly as
 * `TenantAgentRail` reads `canAnswerQuestions()` — always `false` today, so the panel is always the
 * unavailable surface in practice. The other branch is where a platform-scoped conversation lands
 * the moment one exists, without this component needing to change shape again.
 */
export function PlatformAgentRail({ canAnswer }: { canAnswer: boolean }) {
  const content = useMemo(
    () => (
      <AgentPanelFrame>
        {canAnswer ? (
          <AgentEmptyConversation
            title="Ask about the platform"
            description="Organization lifecycle, catalogue and plan state, meters, pricing, provider status, recorded failures."
          />
        ) : (
          <AgentUnavailable configureHref="/platform/providers" />
        )}
      </AgentPanelFrame>
    ),
    [canAnswer],
  );

  useAgentContent(content);
  return null;
}
