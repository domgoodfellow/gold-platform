'use client';

import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@gold/ui/components/empty';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@gold/ui/components/attachment';
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
import { ArrowUp, Check, Copy, FileText, History, LoaderCircle, Paperclip, Plus, RotateCcw, Search, Sparkles, TriangleAlert, X, Bot } from 'lucide-react';
import { cx } from '@/components/class-names';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextArea } from '@/components/controls/inputs';
import {
  ACTION_LABELS,
  type AgentAttachment,
  type AgentConversationSummary,
  type AgentRun,
} from '@/lib/domain/assistant/questions';
import { ATTACHMENT_ACCEPT } from '@/lib/domain/assistant/attachment-rules';
import { attachmentDescription, formatBytes } from './attachment-view';
import { runEvents, type RunEvent } from './run-events';
import { formatRecent } from './recent-time';
import { AnswerText } from './answer-text';

/**
 * The Agent presentation grammar. The panel is a conversation, top to bottom:
 *
 *   workspace rail header (owned by `WorkspaceRightRail`) → conversation header → transcript → composer
 *
 * `TenantAgentRail` is the one chat UI, mounted for the whole organization shell — Platform routes
 * included, since Platform is a scope inside the same organization rather than a second one.
 * `AgentUnavailable` below is the shared fallback surface for a rail with no answering capability
 * behind it yet (`account-agent-rail.tsx`).
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
          <Button type="button" tone="ghost" size="small" className="shrink-0 gap-1.5">
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

      <Button type="button" tone="ghost" size="small" className="shrink-0 gap-1.5" onClick={onNewChat}>
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
 * (Platform Providers). A tenant cannot configure GOLD's own AI provider and has no standing
 * to see that it's a provider at all — the same reasoning ADR-014 already applies to
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
export function AgentEmptyConversation({
  title,
  prompts = [],
  onPickPrompt,
}: {
  title: string;
  /** Questions the Agent can answer today; choosing one puts it in the composer, it never sends. */
  prompts?: string[];
  onPickPrompt?: (prompt: string) => void;
}) {
  return (
    <Empty className="border-none py-8">
      <EmptyMedia variant="icon"><Sparkles aria-hidden /></EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      {prompts.length > 0 && onPickPrompt ? (
        <EmptyContent>
          <ul aria-label="Suggested questions" className="flex w-full flex-col gap-2">
            {prompts.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  onClick={() => onPickPrompt(prompt)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-hover"
                >
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </EmptyContent>
      ) : null}
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
  onReuseQuestion,
}: {
  conversationId: string | null;
  runs: AgentRun[];
  pendingQuestion: { text: string; attachments: AgentAttachment[] } | null;
  decideFormAction: (formData: FormData) => void;
  decidePending: boolean;
  decideError: string | null;
  /** The one hidden field a decide-action needs beyond `runId` — tenant scope carries
   * `organizationId`; platform scope carries none. */
  scopeIdHiddenField: ReactNode;
  /** Puts an earlier question back in the composer to edit and send again. */
  onReuseQuestion: (question: string) => void;
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
                onReuseQuestion={onReuseQuestion}
              />
            ))}

            {pendingQuestion ? (
              <>
                <MessageScrollerItem messageId="pending-question" scrollAnchor>
                  <QuestionMessage text={pendingQuestion.text} attachments={pendingQuestion.attachments} />
                </MessageScrollerItem>
                <MessageScrollerItem messageId="pending-answer">
                  <Message>
                    <MessageContent>
                      <Bubble variant="outline" className="max-w-[90%]">
                        <BubbleContent role="status">
                          <span className="sr-only">Thinking…</span>
                          <ThinkingDots />
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
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

/** Three dots in the Agent's own bubble: it is working, and the reply will land where they are. */
function ThinkingDots() {
  return (
    <span aria-hidden className="flex h-5 items-center gap-1">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-1.5 animate-pulse rounded-full bg-foreground/40"
          style={{ animationDelay: `${dot * 200}ms`, animationDuration: '1.2s' }}
        />
      ))}
    </span>
  );
}

/**
 * Beneath an answer: copy it, or put the question back in the composer. Always visible — a touch
 * screen has no hover — and quiet, so the answer stays the thing on the page.
 */
function AnswerActions({ answer, question, onReuseQuestion }: { answer: string; question: string; onReuseQuestion: (question: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1 text-xs">
      <Button
        type="button"
        tone="ghost"
        size="small"
        className="h-7 gap-1 px-2 text-xs text-muted"
        onClick={() => {
          void navigator.clipboard?.writeText(answer).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? <Check aria-hidden size={13} /> : <Copy aria-hidden size={13} />}
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
      <Button
        type="button"
        tone="ghost"
        size="small"
        className="h-7 gap-1 px-2 text-xs text-muted"
        onClick={() => onReuseQuestion(question)}
      >
        <RotateCcw aria-hidden size={13} />
        Ask again
      </Button>
    </div>
  );
}

/**
 * A sent question, and the files it was sent with beside it. The files are the record of what was
 * handed over — the same cards the composer showed, without the controls — so a reopened
 * conversation reads as it did.
 */
function QuestionMessage({ text, attachments }: { text: string; attachments: AgentAttachment[] }) {
  return (
    <Message align="end">
      <MessageContent>
        {attachments.length > 0 ? (
          <AttachmentGroup className="max-w-[90%] justify-end">
            {attachments.map((attachment) => (
              <Attachment key={attachment.id} size="sm">
                <AttachmentMedia><FileText /></AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{attachment.fileName}</AttachmentTitle>
                  <AttachmentDescription>
                    {attachmentDescription(attachment.mimeType, attachment.sizeBytes)}
                  </AttachmentDescription>
                </AttachmentContent>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
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
  onReuseQuestion,
}: {
  run: AgentRun;
  decideFormAction: (formData: FormData) => void;
  decidePending: boolean;
  decideError: string | null;
  scopeIdHiddenField: ReactNode;
  onReuseQuestion: (question: string) => void;
}) {
  const events = runEvents(run);

  return (
    <>
      <MessageScrollerItem messageId={`${run.id}:question`} scrollAnchor>
        <QuestionMessage text={run.question} attachments={run.attachments} />
      </MessageScrollerItem>

      <MessageScrollerItem messageId={`${run.id}:response`} className="flex flex-col gap-2">
        {events
          .filter((event) => event.kind === 'checked' || event.kind === 'refused')
          .map((event) => (
            <EventMarker key={event.key} event={event} />
          ))}

        {run.outcome === 'answered' ? (
          <>
            <Message>
              <MessageContent>
                <Bubble variant="outline" className="max-w-[90%]">
                  <BubbleContent><AnswerText text={run.answer} /></BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
            <AnswerActions answer={run.answer} question={run.question} onReuseQuestion={onReuseQuestion} />
          </>
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

/** One file the person has picked and not yet sent, at whatever stage it has reached. */
export type ComposerAttachment = {
  key: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  state: 'uploading' | 'done' | 'error';
  /** Set once the file is stored; what the question is sent with. */
  documentId?: string;
  /** In words a person can act on, when `state` is `error`. */
  error?: string;
};

/**
 * The files waiting to be sent, above the textarea: a card each, with where it has got to and a
 * way to take it back. They wrap rather than scroll, so at the rail's narrowest none is hidden.
 */
function ComposerAttachments({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (key: string) => void;
}) {
  return (
    <AttachmentGroup aria-label="Attached files">
      {attachments.map((file) => (
        <Attachment key={file.key} size="sm" state={file.state} className="max-w-full">
          <AttachmentMedia>
            {file.state === 'uploading' ? (
              <LoaderCircle className="animate-spin" />
            ) : file.state === 'error' ? (
              <TriangleAlert />
            ) : (
              <FileText />
            )}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{file.name}</AttachmentTitle>
            <AttachmentDescription role={file.state === 'error' ? 'alert' : undefined}>
              {file.state === 'uploading'
                ? `Uploading… ${formatBytes(file.sizeBytes)}`
                : file.state === 'error'
                  ? (file.error ?? 'Could not attach that file.')
                  : attachmentDescription(file.mimeType, file.sizeBytes)}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              type="button"
              aria-label={file.state === 'uploading' ? `Cancel ${file.name}` : `Remove ${file.name}`}
              onClick={() => onRemove(file.key)}
            >
              <X aria-hidden />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

/**
 * The fixed composer: the files waiting above, the textarea, and a utility toolbar beneath it.
 * Enter sends and Shift+Enter adds a line; the textarea grows to a bound and then scrolls. The
 * paperclip is first on the left, then `tools` (Context); Send is the right.
 *
 * The file input has no `name`, on purpose: a file is uploaded by its own action the moment it is
 * chosen, and the question carries only the ids of files already stored — the form must never
 * submit the bytes a second time.
 */
export function AgentComposer({
  formAction,
  hiddenFields,
  textareaRef,
  disabled,
  pending,
  placeholder,
  tools,
  attachments,
  canAttach,
  onPickFiles,
  onRemoveAttachment,
}: {
  formAction: (formData: FormData) => void;
  hiddenFields: ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
  pending: boolean;
  placeholder: string;
  tools: ReactNode;
  attachments: ComposerAttachment[];
  /** False when nothing more can be attached (the limit is reached). */
  canAttach: boolean;
  onPickFiles: (files: File[]) => void;
  onRemoveAttachment: (key: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  // A question is not sent while a file is still on its way: it would go without it.
  const uploading = attachments.some((file) => file.state === 'uploading');

  function grow(element: HTMLTextAreaElement) {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }

  return (
    <form
      action={formAction}
      // React empties the field after a successful send; the height it grew to goes with it.
      onReset={() => setTimeout(() => textareaRef.current && (textareaRef.current.style.height = 'auto'))}
      className="shrink-0 border-t border-border p-3"
    >
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-2 focus-within:border-foreground/40 has-[textarea:disabled]:opacity-70">
      {hiddenFields}
      {attachments.map((file) =>
        file.state === 'done' && file.documentId ? (
          <input key={file.key} type="hidden" name="documentId" value={file.documentId} />
        ) : null,
      )}
      {attachments.length > 0 ? (
        <ComposerAttachments attachments={attachments} onRemove={onRemoveAttachment} />
      ) : null}
      <TextArea
        ref={textareaRef}
        name="question"
        rows={2}
        required
        disabled={disabled}
        size="small"
        placeholder={placeholder}
        aria-label="Message to the Agent"
        className="min-h-12 w-full resize-none border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0 focus-visible:outline-none md:text-sm"
        style={{ maxHeight: COMPOSER_MAX_HEIGHT }}
        onInput={(event: FormEvent<HTMLTextAreaElement>) => grow(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!pending && !uploading && event.currentTarget.value.trim()) event.currentTarget.form?.requestSubmit();
        }}
      />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        accept={ATTACHMENT_ACCEPT}
        onChange={(event) => {
          onPickFiles(Array.from(event.currentTarget.files ?? []));
          // So choosing the same file again is a choice.
          event.currentTarget.value = '';
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            tone="ghost"
            size="small"
            className="size-8 shrink-0 p-0"
            aria-label="Attach files"
            title="Attach files"
            disabled={disabled || !canAttach}
            onClick={() => picker.current?.click()}
          >
            <Paperclip aria-hidden size={14} />
          </Button>
          {tools}
        </div>
        <Button
          type="submit"
          size="small"
          disabled={disabled || pending || uploading}
          className="ml-auto size-8 shrink-0 rounded-full p-0"
        >
          {pending ? <LoaderCircle aria-hidden size={16} className="animate-spin" /> : <ArrowUp aria-hidden size={16} />}
          <span className="sr-only">{pending ? 'Sending…' : 'Send'}</span>
        </Button>
      </div>
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
        <Button type="button" tone="ghost" size="small" className="gap-1.5 text-muted">
          {icon}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        className="flex max-h-(--radix-popover-content-available-height) w-72 max-w-(--radix-popover-content-available-width) flex-col gap-3 overflow-y-auto p-3"
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
