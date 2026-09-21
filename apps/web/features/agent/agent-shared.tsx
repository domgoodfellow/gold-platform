'use client';

import { useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@gold/ui/components/empty';
import { Bubble, BubbleContent } from '@gold/ui/components/bubble';
import { Marker, MarkerContent, MarkerIcon } from '@gold/ui/components/marker';
import { Message, MessageContent } from '@gold/ui/components/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@gold/ui/components/message-scroller';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { Bot, Check, History, LoaderCircle, Plus, Search, TriangleAlert } from 'lucide-react';
import { cx } from '@/components/class-names';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextArea } from '@/components/controls/inputs';
import {
  ACTION_LABELS,
  type AgentConversationSummary,
  type AgentRun,
} from '@/lib/domain/assistant/questions';
import { runEvents, type RunEvent } from './run-events';
import { formatRecent } from './recent-time';

/**
 * The Agent presentation grammar, shared by Tenant scope and Platform scope alike (constraints.md
 * — the shell/context correction). The panel is a conversation, top to bottom:
 *
 *   workspace rail header (owned by `WorkspaceRightRail`) → conversation header → transcript → composer
 *
 * Neither scope gets its own chat UI; only the data and the capability check differ, supplied by
 * `TenantAgentRail`/`PlatformAgentRail`.
 */

/** The four-region column. The transcript is the only thing in it that scrolls. */
export function AgentPanelFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-1 flex-col">{children}</div>;
}

/**
 * The conversation's own header: its title on the left, History and New chat on the right. A
 * conversation that has not sent its first question has no title yet, so `title` is `New chat`.
 * Presentation only — which conversation is current, and what opening or starting one does, is
 * the scope's to say. `currentId` is null for a New chat.
 */
export function AgentConversationHeader({
  title,
  conversations,
  currentId,
  onOpen,
  onNewChat,
}: {
  title: string;
  conversations: AgentConversationSummary[];
  currentId: string | null;
  onOpen: (conversationId: string) => void;
  onNewChat: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" tone="secondary" size="small" className="shrink-0 gap-1.5">
            <History aria-hidden size={14} />
            History
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={8}
          className="w-72 max-w-(--radix-popover-content-available-width) p-1"
        >
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">No conversations yet.</p>
          ) : (
            <ul className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] flex-col gap-0.5 overflow-y-auto">
              {conversations.map((conversation) => {
                const current = conversation.id === currentId;
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        setOpen(false);
                        onOpen(conversation.id);
                      }}
                      className={cx(
                        'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover',
                        current && 'bg-selected',
                      )}
                    >
                      <span className="w-full truncate font-medium">{conversation.title}</span>
                      <span className="text-xs text-muted">{formatRecent(conversation.lastActivityAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <Button type="button" tone="secondary" size="small" className="shrink-0 gap-1.5" onClick={onNewChat}>
        <Plus aria-hidden size={14} />
        New chat
      </Button>
    </div>
  );
}

/**
 * **Infrastructure unavailable — never confused with "no conversation yet".** A blank composer
 * would let somebody type a question into a deployment that cannot answer it; this is the
 * deliberate status surface instead: what's wrong, and — only when there's a real next action — a
 * link straight to it.
 *
 * Platform staff can act on a missing provider, so they see the actual next step
 * (`/platform/providers`). A tenant cannot configure GOLD's own AI provider and has no standing
 * to see that it's a provider at all — the same reasoning `constraints.md` already applies to
 * GOLD's own cost never reaching a tenant — so they see only that Agent is unavailable right now.
 */
export function AgentUnavailable({
  configureHref,
}: {
  /** Present only for an audience that can act on it (Platform staff). Absent for a tenant. */
  configureHref?: string;
}) {
  return (
    <Empty className="border-none py-8">
      <EmptyMedia variant="icon"><Bot aria-hidden /></EmptyMedia>
      <EmptyTitle>Agent unavailable</EmptyTitle>
      <EmptyDescription>
        {configureHref
          ? 'Configure an AI provider/model before Platform Agent can answer.'
          : 'Agent is currently unavailable.'}
      </EmptyDescription>
      {configureHref ? (
        <EmptyContent>
          <ButtonLink href={configureHref} tone="secondary" size="small">
            Configure providers
          </ButtonLink>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

/** Zero turns, infrastructure genuinely available — the composer is the point, not an empty box. */
export function AgentEmptyConversation({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="border-none py-8">
      <EmptyMedia variant="icon"><Bot aria-hidden /></EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </Empty>
  );
}

const EVENT_ICON = {
  checked: Search,
  refused: TriangleAlert,
  done: Check,
  failed: TriangleAlert,
  declined: Check,
} as const;

/**
 * One conversation's transcript. `MessageScroller` owns the scrolling, the live edge and the
 * anchoring — there is no other scroll container in the Chat region, and adding one would fight
 * it. Questions sit at the end, the Agent's words at the start, and a proposed action sits
 * directly beneath the response it belongs to.
 *
 * `runs` arrive newest first, as every transcript read does. `pendingQuestion` is a question that
 * has been sent and not yet answered: it shows at once, with a *Thinking…* note beneath it.
 */
export function AgentTranscript({
  conversationId,
  runs,
  pendingQuestion,
  decideFormAction,
  decidePending,
  decideError,
  scopeIdHiddenField,
}: {
  conversationId: string | null;
  runs: AgentRun[];
  pendingQuestion: string | null;
  decideFormAction: (formData: FormData) => void;
  decidePending: boolean;
  decideError: string | null;
  /** The one hidden field a decide-action needs beyond `runId` — tenant scope carries
   * `organizationId`; platform scope carries none. */
  scopeIdHiddenField: ReactNode;
}) {
  const ordered = [...runs].reverse();

  return (
    // Keyed by conversation so switching one never inherits another's scroll position.
    <MessageScrollerProvider key={conversationId ?? 'new'} autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label="Conversation" className="px-4 py-4">
          <MessageScrollerContent>
            {ordered.map((run) => (
              <TurnItems
                key={run.id}
                run={run}
                decideFormAction={decideFormAction}
                decidePending={decidePending}
                decideError={decideError}
                scopeIdHiddenField={scopeIdHiddenField}
              />
            ))}

            {pendingQuestion ? (
              <>
                <MessageScrollerItem messageId="pending-question" scrollAnchor>
                  <QuestionMessage text={pendingQuestion} />
                </MessageScrollerItem>
                <MessageScrollerItem messageId="pending-answer">
                  <Marker role="status">
                    <MarkerIcon><LoaderCircle className="animate-spin" /></MarkerIcon>
                    <MarkerContent>Thinking…</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              </>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function QuestionMessage({ text }: { text: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble variant="secondary" align="end" className="max-w-[90%]">
          <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function TurnItems({
  run,
  decideFormAction,
  decidePending,
  decideError,
  scopeIdHiddenField,
}: {
  run: AgentRun;
  decideFormAction: (formData: FormData) => void;
  decidePending: boolean;
  decideError: string | null;
  scopeIdHiddenField: ReactNode;
}) {
  const events = runEvents(run);

  return (
    <>
      <MessageScrollerItem messageId={`${run.id}:question`} scrollAnchor>
        <QuestionMessage text={run.question} />
      </MessageScrollerItem>

      <MessageScrollerItem messageId={`${run.id}:response`} className="flex flex-col gap-2">
        {events
          .filter((event) => event.kind === 'checked' || event.kind === 'refused')
          .map((event) => (
            <EventMarker key={event.key} event={event} />
          ))}

        {run.outcome === 'answered' ? (
          <Message>
            <MessageContent>
              <Bubble variant="outline" className="max-w-[90%]">
                <BubbleContent className="whitespace-pre-wrap">{run.answer}</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
        ) : null}

        {run.outcome === 'unanswered' ? (
          <Marker>
            <MarkerContent>Nothing came back — there was no answer to be had from what this platform can look at.</MarkerContent>
          </Marker>
        ) : null}

        {run.outcome === 'failed' ? (
          <Message>
            <MessageContent>
              <Bubble variant="destructive" className="max-w-[90%]">
                <BubbleContent role="alert">{run.detail}</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
        ) : null}

        {run.proposedAction && run.actionOutcome === 'pending' ? (
          <form action={decideFormAction} className="flex max-w-[90%] flex-col gap-2 rounded-lg border border-border p-2">
            {scopeIdHiddenField}
            <input type="hidden" name="runId" value={run.id} />
            <p className="text-xs font-medium">{ACTION_LABELS[run.proposedAction.name] ?? run.proposedAction.name}</p>
            <p className="text-xs text-muted">{run.proposedAction.because}</p>
            <div className="flex gap-2">
              <Button type="submit" name="decision" value="decline" tone="secondary" size="small" disabled={decidePending}>
                Decline
              </Button>
              <Button type="submit" name="decision" value="carry-out" tone="primary" size="small" disabled={decidePending}>
                {decidePending ? 'Working…' : 'Approve'}
              </Button>
            </div>
            {decideError ? <p role="alert" className="text-xs text-danger">{decideError}</p> : null}
          </form>
        ) : null}

        {events
          .filter((event) => event.kind === 'done' || event.kind === 'failed' || event.kind === 'declined')
          .map((event) => (
            <EventMarker key={event.key} event={event} />
          ))}
      </MessageScrollerItem>
    </>
  );
}

function EventMarker({ event }: { event: RunEvent }) {
  const Icon = EVENT_ICON[event.kind];
  return (
    <Marker>
      <MarkerIcon><Icon /></MarkerIcon>
      <MarkerContent>{event.text}</MarkerContent>
    </Marker>
  );
}

/** The most the composer grows before it scrolls inside itself. */
const COMPOSER_MAX_HEIGHT = 160;

/**
 * The fixed composer: the textarea above, a utility toolbar beneath it. Enter sends and
 * Shift+Enter adds a line; the textarea grows to a bound and then scrolls. `tools` is the left of
 * the toolbar (Context, Configure — and, the day it exists, Attachment); Send is the right.
 * There is no attachment button here because nothing yet accepts an attachment.
 */
export function AgentComposer({
  formAction,
  hiddenFields,
  textareaRef,
  disabled,
  pending,
  placeholder,
  tools,
}: {
  formAction: (formData: FormData) => void;
  hiddenFields: ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
  pending: boolean;
  placeholder: string;
  tools: ReactNode;
}) {
  function grow(element: HTMLTextAreaElement) {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }

  return (
    <form
      action={formAction}
      // React empties the field after a successful send; the height it grew to goes with it.
      onReset={() => setTimeout(() => textareaRef.current && (textareaRef.current.style.height = 'auto'))}
      className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
    >
      {hiddenFields}
      <TextArea
        ref={textareaRef}
        name="question"
        rows={2}
        required
        disabled={disabled}
        size="small"
        placeholder={placeholder}
        aria-label="Message to the Agent"
        className="w-full resize-none"
        style={{ maxHeight: COMPOSER_MAX_HEIGHT }}
        onInput={(event: FormEvent<HTMLTextAreaElement>) => grow(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!pending && event.currentTarget.value.trim()) event.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{tools}</div>
        <Button type="submit" size="small" disabled={disabled || pending} className="ml-auto">
          {pending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}

/**
 * A composer-toolbar popover. It opens above the composer and never wider than the space the rail
 * leaves it, so at the rail's 320px minimum it still fits — on a phone the rail is the whole
 * width and the same rule applies.
 */
export function AgentToolPopover({
  label,
  icon,
  title,
  children,
}: {
  label: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" tone="secondary" size="small" className="gap-1.5">
          {icon}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        className="flex w-72 max-w-(--radix-popover-content-available-width) flex-col gap-3 p-3"
      >
        <p className="text-sm font-medium">{title}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** What the Agent will be given for its next turn, as label and value. Inspection only — nothing here can be edited. */
export function AgentContextFacts({ facts }: { facts: { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">{fact.label}</dt>
          <dd className="wrap-break-word">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
