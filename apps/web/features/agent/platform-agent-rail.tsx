'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAgentContent } from '@/components/containers/workspace-right-rail';
import {
  AgentActivityList,
  AgentContextList,
  AgentEmptyConversation,
  AgentTabs,
  AgentUnavailable,
} from './agent-shared';
import { PLATFORM_NAV } from '@/features/platform/platform-navigation';

const ORGANIZATION_IN_PATH = /^\/platform\/organizations\/([^/]+)/;

function currentPlatformWorkspace(pathname: string): string {
  if (pathname === '/platform') return 'Overview';
  const match = [...PLATFORM_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => item.href !== '/platform' && pathname.startsWith(item.href));
  return match?.label ?? 'Platform';
}

/**
 * Registers the Agent rail's content for Platform scope. Its own component, not the tenant one
 * pointed at a stand-in organization (rule 13 of the shell/context correction) — no
 * `organizationId` prop exists here at all. Answering capability comes from
 * `canAnswerPlatformQuestions`, which is honestly `false` until a platform-scoped answering
 * endpoint exists (see that function's own comment) — so this renders the real "Agent
 * unavailable" surface, pointed at `/platform/providers`, rather than a composer with nothing
 * behind it.
 *
 * `canAnswer` comes from `canAnswerPlatformQuestions()`, read in `platform/layout.tsx` exactly as
 * `TenantAgentRail` reads `canAnswerQuestions()` — always `false` today (see that function's own
 * comment), so the chat tab is always the unavailable surface in practice. The branch below is
 * not dead code for its own sake: it is where a real platform-scoped answering endpoint's runs
 * and composer land the moment one exists, without this component needing to change shape again.
 */
export function PlatformAgentRail({ canAnswer }: { canAnswer: boolean }) {
  const pathname = usePathname();
  const workspace = currentPlatformWorkspace(pathname);
  const selectedOrganizationId = pathname.match(ORGANIZATION_IN_PATH)?.[1];

  const content = useMemo(() => {
    const contextItems = [
      { title: 'Current scope', description: 'GOLD' },
      { title: 'Current workspace', description: workspace },
      // A selected organization is additional context for a support/inspection workflow, never a
      // switch of scope — Platform Agent does not become that organization's Agent by this (rule
      // 13). Shown by id only: this component has no organization reader of its own, and adding
      // one only to print a name would be the first thread pulling this back toward tenant data.
      ...(selectedOrganizationId
        ? [{ title: 'Selected organization', description: selectedOrganizationId }]
        : []),
    ];

    return (
      <AgentTabs
        chat={
          canAnswer ? (
            <AgentEmptyConversation
              title="Ask about the platform"
              description="Organization lifecycle, catalogue and plan state, meters, pricing, provider status, recorded failures."
            />
          ) : (
            <AgentUnavailable configureHref="/platform/providers" />
          )
        }
        context={<AgentContextList items={contextItems} />}
        activity={<AgentActivityList runs={[]} />}
      />
    );
  }, [workspace, selectedOrganizationId, canAnswer]);

  useAgentContent(content);
  return null;
}
