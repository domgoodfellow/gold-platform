'use client';

import { useActionState, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { Checkbox } from '@gold/ui/components/checkbox';
import { SlidersHorizontal, Info } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { useAgentContent } from '@/components/containers/workspace-right-rail';
import {
  AgentComposer,
  AgentContextFacts,
  AgentConversationHeader,
  AgentEmptyConversation,
  AgentPanelFrame,
  AgentToolPopover,
  AgentTranscript,
  AgentUnavailable,
} from './agent-shared';
import { resolveAgentViewing } from './agent-context';
import {
  deriveConversationTitle,
  type AgentConversationSummary,
  type AgentRun,
} from '@/lib/domain/assistant/questions';
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
 * Which conversation the panel shows. `default` follows what the shell loaded (the most recent
 * one), so a hard refresh lands there without a conversation id in any URL. `new` is the unsaved
 * empty state — nothing exists in the database until its first question is sent. `opened` is one
 * somebody picked from History, or the one they just asked into, held with the transcript the last
 * action returned.
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
 * The panel is a conversation: conversation header → transcript → composer, under the workspace
 * rail's own Agent header. It owns the selected conversation, so the header, the transcript and
 * the composer cannot disagree about which one they mean, and it lives above all three so
 * nothing is lost when a popover opens.
 */
function TenantAgentPanel({
  organizationId,
  organizationName,
  timezone,
  canAnswer,
  mayAsk,
  canManageConnections,
  conversations,
  initialConversation,
}: {
  organizationId: string;
  organizationName: string;
  timezone: string;
  canAnswer: boolean;
  mayAsk: boolean;
  canManageConnections: boolean;
  conversations: AgentConversationSummary[];
  initialConversation: InitialConversation | null;
}) {
  const [view, setView] = useState<View>({ kind: 'default' });
  const [askError, setAskError] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  // A runtime control for the next questions, not a stored setting: whether the record open on
  // the page is named to the Agent. Durable configuration stays in Settings.
  const [includeRecord, setIncludeRecord] = useState(true);
  const [opening, startOpening] = useTransition();
  const composer = useRef<HTMLTextAreaElement>(null);

  const pathname = usePathname();
  const viewing = resolveAgentViewing(pathname);

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
      // Shown at once, with a Thinking note beneath it, until the answer is recorded.
      setPendingQuestion(String(formData.get('question') ?? '').trim());
      setAskError(null);
      try {
        const result = await askAction(previous, formData);
        apply(result, setAskError);
        return result;
      } finally {
        setPendingQuestion(null);
      }
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

  if (!canAnswer) {
    return (
      <AgentPanelFrame>
        <AgentUnavailable />
      </AgentPanelFrame>
    );
  }

  const title = shown
    ? (conversations.find((conversation) => conversation.id === shown.id)?.title ??
      deriveConversationTitle(shown.runs.at(-1)?.question ?? 'New chat'))
    : 'New chat';

  const facts = [
    { label: 'Business', value: organizationName },
    ...(viewing.workspace ? [{ label: 'Current workspace', value: viewing.workspace }] : []),
    ...(viewing.recordId && viewing.workspace
      ? [
          {
            label: 'Open record',
            value: includeRecord ? `A record in ${viewing.workspace}` : 'Not shared — turned off in Configure',
          },
        ]
      : []),
    { label: 'Business time zone', value: timezone },
  ];

  const hasTurns = (shown?.runs.length ?? 0) > 0 || pendingQuestion !== null;

  return (
    <AgentPanelFrame>
      <AgentConversationHeader
        title={title}
        conversations={conversations}
        currentId={shown?.id ?? null}
        onOpen={openConversation}
        onNewChat={newChat}
      />

      {hasTurns ? (
        <AgentTranscript
          conversationId={shown?.id ?? null}
          runs={shown?.runs ?? []}
          pendingQuestion={pendingQuestion}
          decideFormAction={decideFormAction}
          decidePending={deciding}
          decideError={decideError}
          scopeIdHiddenField={<input type="hidden" name="organizationId" value={organizationId} />}
        />
      ) : (
        <div aria-busy={opening} className="min-h-0 flex-1">
          <AgentEmptyConversation
            title="Ask about this business"
            description="What is at risk of being late today, what is booked with nobody assigned."
          />
        </div>
      )}

      {askError ? (
        <p role="alert" className="shrink-0 px-4 pb-2 text-sm text-danger">
          {askError}
        </p>
      ) : null}

      <AgentComposer
        formAction={askFormAction}
        textareaRef={composer}
        disabled={!mayAsk}
        pending={asking}
        placeholder={mayAsk ? 'Ask about this business…' : 'Your role cannot ask questions here.'}
        hiddenFields={
          <>
            <input type="hidden" name="organizationId" value={organizationId} />
            {/* Empty for a New chat: the first question creates the conversation. */}
            <input type="hidden" name="conversationId" value={shown?.id ?? ''} />
            {/* The server re-derives the workspace from this path; it never trusts a label. */}
            <input type="hidden" name="pathname" value={pathname} />
            <input type="hidden" name="includeRecord" value={includeRecord ? 'on' : ''} />
          </>
        }
        tools={
          <>
            <AgentToolPopover label="Context" icon={<Info aria-hidden size={14} />} title="What the Agent sees next">
              <AgentContextFacts facts={facts} />
              <p className="text-xs text-muted">This follows the page you are on. To change what it may use, see Configure.</p>
            </AgentToolPopover>

            <AgentToolPopover label="Configure" icon={<SlidersHorizontal aria-hidden size={14} />} title="This conversation">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="agent-include-record"
                  checked={includeRecord}
                  onCheckedChange={(checked) => setIncludeRecord(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor="agent-include-record" className="flex flex-col gap-0.5 text-sm">
                  Include the open record
                  <span className="text-xs text-muted">
                    Names the record on your page to the Agent for your next questions.
                  </span>
                </label>
              </div>
              {canManageConnections ? (
                <ButtonLink href={`/organizations/${organizationId}/integrations`} tone="secondary" size="small" className="w-fit">
                  Connections &amp; permissions
                </ButtonLink>
              ) : null}
            </AgentToolPopover>
          </>
        }
      />
    </AgentPanelFrame>
  );
}

/** Registers the Agent rail's content for Tenant scope, once, at the organization shell root, so
 * it survives every page's own mount/unmount as somebody navigates the business. Renders nothing
 * itself. */
export function TenantAgentRail(props: {
  organizationId: string;
  organizationName: string;
  timezone: string;
  canAnswer: boolean;
  mayAsk: boolean;
  canManageConnections: boolean;
  conversations: AgentConversationSummary[];
  initialConversation: InitialConversation | null;
}) {
  const {
    organizationId,
    organizationName,
    timezone,
    canAnswer,
    mayAsk,
    canManageConnections,
    conversations,
    initialConversation,
  } = props;

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
        timezone={timezone}
        canAnswer={canAnswer}
        mayAsk={mayAsk}
        canManageConnections={canManageConnections}
        conversations={conversations}
        initialConversation={initialConversation}
      />
    ),
    [organizationId, organizationName, timezone, canAnswer, mayAsk, canManageConnections, conversations, initialConversation],
  );
  useAgentContent(content);
  return null;
}
