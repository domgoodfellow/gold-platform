'use client';

import { useMemo } from 'react';
import { useAgentContent } from '@/components/containers/workspace-right-rail';
import { AgentUnavailable } from '@/features/agent/agent-shared';

/**
 * Registers the Agent rail's content for Account. There is nothing here for it to act on — no
 * business, no platform — so it shows the same "unavailable" state every scope already uses when
 * it has nothing to answer, rather than inventing account-specific behavior. Renders nothing
 * itself.
 */
export function AccountAgentRail() {
  const content = useMemo(() => <AgentUnavailable />, []);
  useAgentContent(content);
  return null;
}
