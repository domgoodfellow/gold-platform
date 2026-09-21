'use client';

import { useActionState, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { ErrorText, TextArea } from '@/components/controls/inputs';
import { useAgentContent } from '@/components/containers/workspace-right-rail';
import {
  AgentActivityList,
  AgentChatToolbar,
  AgentContextList,
  AgentConversation,
  AgentEmptyConversation,
  AgentTabs,
  AgentUnavailable,
} from './agent-shared';
import type { AgentConversationSummary, AgentRun } from '@/lib/domain/assistant/questions';
import { AREAS, currentSegment } from '@/lib/navigation';
import {
  askAction,
  decideAction,
  openConversationAction,
  type AskActionState,
} from './actions';

const INITIAL: AskActionState = { error: null };

/** The transcript the shell loaded: the most recent conversation, and nothing older. */
export type InitialConversation = { id: string; runs: AgentRun[] };

/**
 * Which conversation the Chat and Activity tabs show. `default` follows what the shell loaded
 * (the most recent one), so a hard refresh lands there without a conversation id in any URL.
 * `new` is the unsaved empty state — nothing exists in the database until its first question is
 * sent. `opened` is one somebody picked from History, or the one they just asked into, held with
 * the transcript the last action returned.
 */
type View =
  | { kind: 'default' }
  | { kind: 'new' }
  | { kind: 'opened'; conversationId: string; runs: AgentRun[] };

/**
 * Tenant scope. `askQuestion` never streams and answers under the caller's own session
 * (`constraints.md` D34); each question carries the earlier finished turns of the *same*
 * conversation, read by the domain layer, never by this component.
 *
 * Owns the selected conversation so the Chat and Activity tabs cannot disagree about which one
 * they mean. Lives above the tabs, so switching tabs loses nothing.
 */
function TenantAgentPanel({
  organizationId,
  organizationName,
  canAnswer,
  mayAsk,
  conversations,
  initialConversation,
}: {
  organizationId: string;
  organizationName: string;
  canAnswer: boolean;
  mayAsk: boolean;
  conversations: AgentConversationSummary[];
  initialConversation: InitialConversation | null;
}) {
  const [view, setView] = useState<View>({ kind: 'default' });
  const [askError, setAskError] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  const composer = useRef<HTMLTextAreaElement>(null);

  const segment = currentSegment(usePathname());
  const area = AREAS.find((candidate) => candidate.segment === segment);

  const shown =
    view.kind === 'default'
      ? initialConversation && { id: initialConversation.id, runs: initialConversation.runs }
      : view.kind === 'new'
        ? null
        : { id: view.conversationId, runs: view.runs };

  // An action's result is applied here rather than left to a layout refresh: the run just written
  // appears whichever organization page the question came from.
  function apply(result: AskActionState, fail: (message: string | null) => void) {
    fail(result.error);
    if (!result.error && result.conversationId && result.runs) {
      setView({ kind: 'opened', conversationId: result.conversationId, runs: result.runs });
    }
  }

  const [, askFormAction, asking] = useActionState(
    async (previous: AskActionState, formData: FormData) => {
      const result = await askAction(previous, formData);
      apply(result, setAskError);
      return result;
    },
    INITIAL,
  );
  const [, decideFormAction, deciding] = useActionState(
    async (previous: AskActionState, formData: FormData) => {
      const result = await decideAction(previous, formData);
      apply(result, setDecideError);
      return result;
    },
    INITIAL,
  );

  function openConversation(conversationId: string) {
    setAskError(null);
    setDecideError(null);
    startOpening(async () => {
      const result = await openConversationAction(organizationId, conversationId);
      apply(result, setAskError);
    });
  }

  function newChat() {
    setAskError(null);
    setDecideError(null);
    setView({ kind: 'new' });
    composer.current?.focus();
  }

  const chat = !canAnswer ? (
    <AgentUnavailable />
  ) : (
    <>
      <AgentChatToolbar
        conversations={conversations}
        currentId={shown?.id ?? null}
        onOpen={openConversation}
        onNewChat={newChat}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div aria-busy={opening} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {!shown || shown.runs.length === 0 ? (
            <AgentEmptyConversation
              title="Ask about this business"
              description="What is at risk of being late today, what is booked with nobody assigned."
            />
          ) : (
            <AgentConversation
              runs={shown.runs}
              decideFormAction={decideFormAction}
              decidePending={deciding}
              decideError={decideError}
              scopeIdHiddenField={<input type="hidden" name="organizationId" value={organizationId} />}
            />
          )}
        </div>

        <form action={askFormAction} className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          {/* Empty for a New chat: the first question creates the conversation. */}
          <input type="hidden" name="conversationId" value={shown?.id ?? ''} />
          <TextArea
            ref={composer}
            name="question"
            rows={2}
            required
            disabled={!mayAsk}
            size="small"
            placeholder={mayAsk ? 'Ask about this business…' : `Your role cannot ask questions here.`}
            className="w-full"
          />
          <Button type="submit" disabled={!mayAsk || asking} tone="secondary" size="small" className="w-fit self-end">
            {asking ? 'Asking…' : 'Ask'}
          </Button>
          {askError ? <ErrorText role="alert">{askError}</ErrorText> : null}
        </form>
      </div>
    </>
  );

  return (
    <AgentTabs
      chat={chat}
      context={
        <AgentContextList
          items={[
            { title: 'Business', description: organizationName },
            { title: 'Current workspace', description: area?.label ?? 'Unknown' },
          ]}
        />
      }
      activity={<AgentActivityList runs={shown?.runs ?? []} />}
    />
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
  conversations: AgentConversationSummary[];
  initialConversation: InitialConversation | null;
}) {
  const { organizationId, organizationName, canAnswer, mayAsk, conversations, initialConversation } = props;

  // Memoized so `useAgentContent`'s effect — keyed on this element's identity — runs once rather
  // than on every re-render this component takes as a `RailContext` consumer (it re-renders
  // whenever *any* rail state changes, including its own registration taking effect). Keyed by
  // business so a selection never outlives switching to another one.
  const content = useMemo(
    () => (
      <TenantAgentPanel
        key={organizationId}
        organizationId={organizationId}
        organizationName={organizationName}
        canAnswer={canAnswer}
        mayAsk={mayAsk}
        conversations={conversations}
        initialConversation={initialConversation}
      />
    ),
    [organizationId, organizationName, canAnswer, mayAsk, conversations, initialConversation],
  );
  useAgentContent(content);
  return null;
}
