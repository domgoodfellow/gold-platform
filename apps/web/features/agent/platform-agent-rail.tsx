'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAgentContent, useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import { AgentEmptyConversation, AgentPanelFrame, AgentUnavailable } from './agent-shared';
import { loadPlatformAgentAvailabilityAction } from './actions';

/**
 * Registers the Agent rail's content for Platform scope. Its own component, not the tenant one
 * pointed at a stand-in organization (rule 13 of the shell/context correction) — no
 * `organizationId` prop exists here at all, and no conversation, composer or answering action is
 * reachable from it. Answering capability comes from `canAnswerPlatformQuestions`, which is
 * honestly `false` until a platform-scoped answering endpoint exists (see that function's own
 * comment) — so this renders the real "Agent unavailable" surface, pointed at
 * the Providers page (`configureHref`), rather than a composer with nothing behind it.
 *
 * `canAnswer` is read lazily, from `loadPlatformAgentAvailabilityAction`, the first time the panel
 * is actually opened — the same first-open rule `TenantAgentRail` applies, and for the same
 * reason: this component mounts on every Platform page regardless of whether Agent is ever opened.
 * It is always `false` today, so the panel is always the unavailable surface in practice. The
 * other branch is where a platform-scoped conversation lands the moment one exists, without this
 * component needing to change shape again.
 */
export function PlatformAgentRail({ goldId, configureHref }: { goldId: string; configureHref: string }) {
  const { agentOpen } = useWorkspaceRail();
  const [everOpened, setEverOpened] = useState(false);
  if (agentOpen && !everOpened) setEverOpened(true);

  const [canAnswer, setCanAnswer] = useState<boolean | null>(null);
  useEffect(() => {
    if (!everOpened || canAnswer !== null) return;
    let active = true;
    void loadPlatformAgentAvailabilityAction(goldId).then((result) => {
      if (active) setCanAnswer(result);
    });
    return () => {
      active = false;
    };
  }, [everOpened, canAnswer, goldId]);

  const content = useMemo(() => {
    if (!everOpened) return null;
    if (canAnswer === null) {
      return (
        <AgentPanelFrame>
          <div role="status" className="flex flex-1 items-center justify-center text-sm text-muted">
            Loading…
          </div>
        </AgentPanelFrame>
      );
    }
    return (
      <AgentPanelFrame>
        {canAnswer ? (
          <AgentEmptyConversation
            title="Ask about the platform"
            description="Organization lifecycle, catalogue and plan state, meters, pricing, provider status, recorded failures."
          />
        ) : (
          <AgentUnavailable configureHref={configureHref} />
        )}
      </AgentPanelFrame>
    );
  }, [everOpened, canAnswer, configureHref]);

  useAgentContent(content);
  return null;
}
