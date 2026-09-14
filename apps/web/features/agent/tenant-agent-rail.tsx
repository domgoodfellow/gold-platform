'use client';

import { useActionState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { ErrorText, TextArea } from '@/components/controls/inputs';
import { useAgentContent } from '@/components/containers/workspace-right-rail';
import {
  AgentActivityList,
  AgentContextList,
  AgentConversation,
  AgentEmptyConversation,
  AgentTabs,
  AgentUnavailable,
} from './agent-shared';
import type { AgentRun } from '@/lib/domain/assistant/questions';
import { AREAS, currentSegment } from '@/lib/navigation';
import { askAction, decideAction, type AskActionState } from '@/app/organizations/[organizationId]/ask/actions';

const INITIAL: AskActionState = { error: null };

/**
 * Tenant scope: `askQuestion` never streams and answers under the caller's own session
 * (`constraints.md` D34) — chat is one question/one answer, built on the same domain read
 * `/ask` uses. Rebuilding this as a turn-by-turn conversation is a later slice, once
 * `packages/ui` carries the message vocabulary for it; this proves the rail can host it and
 * switch away from it without losing state.
 */
function TenantChat({ organizationId, runs, canAnswer, mayAsk }: { organizationId: string; runs: AgentRun[]; canAnswer: boolean; mayAsk: boolean }) {
  const [state, formAction, pending] = useActionState(askAction, INITIAL);
  const [decideState, decideFormAction, decidePending] = useActionState(decideAction, INITIAL);

  if (!canAnswer) {
    return <AgentUnavailable />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {runs.length === 0 ? (
          <AgentEmptyConversation
            title="Ask about this business"
            description="What is at risk of being late today, what is booked with nobody assigned."
          />
        ) : (
          <AgentConversation
            runs={runs}
            decideFormAction={decideFormAction}
            decidePending={decidePending}
            decideError={decideState.error}
            scopeIdHiddenField={<input type="hidden" name="organizationId" value={organizationId} />}
          />
        )}
      </div>

      <form action={formAction} className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <TextArea
          name="question"
          rows={2}
          required
          disabled={!mayAsk}
          size="small"
          placeholder={mayAsk ? 'Ask about this business…' : `Your role cannot ask questions here.`}
          className="w-full"
        />
        <Button type="submit" disabled={!mayAsk || pending} tone="secondary" size="small" className="w-fit self-end">
          {pending ? 'Asking…' : 'Ask'}
        </Button>
        {state.error ? <ErrorText role="alert">{state.error}</ErrorText> : null}
      </form>
    </div>
  );
}

/** Registers the Agent rail's content for Tenant scope, once, at the organization shell root, so
 * it survives every page's own mount/unmount as somebody navigates the business. Renders nothing
 * itself. */
export function TenantAgentRail(props: {
  organizationId: string;
  organizationName: string;
  canAnswer: boolean;
  mayAsk: boolean;
  runs: AgentRun[];
}) {
  const { organizationId, organizationName, canAnswer, mayAsk, runs } = props;
  const segment = currentSegment(usePathname());
  const area = AREAS.find((candidate) => candidate.segment === segment);

  // Memoized so `useAgentContent`'s effect — keyed on this element's identity — runs once rather
  // than on every re-render this component takes as a `RailContext` consumer (it re-renders
  // whenever *any* rail state changes, including its own registration taking effect).
  const content = useMemo(
    () => (
      <AgentTabs
        chat={<TenantChat organizationId={organizationId} runs={runs} canAnswer={canAnswer} mayAsk={mayAsk} />}
        context={
          <AgentContextList
            items={[
              { title: 'Business', description: organizationName },
              { title: 'Current workspace', description: area?.label ?? 'Unknown' },
            ]}
          />
        }
        activity={<AgentActivityList runs={runs} />}
      />
    ),
    [organizationId, organizationName, canAnswer, mayAsk, runs, area],
  );
  useAgentContent(content);
  return null;
}
