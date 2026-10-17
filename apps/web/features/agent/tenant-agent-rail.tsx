'use client';

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { Checkbox } from '@gold/ui/components/checkbox';
import { SlidersHorizontal } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { useAgentContent, useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import {
  AgentComposer,
  AgentContextFacts,
  AgentConversationHeader,
  AgentEmptyConversation,
  AgentPanelFrame,
  AgentToolPopover,
  AgentTranscript,
  type ComposerAttachment,
} from './agent-shared';
import { resolveAgentViewing } from './agent-context';
import {
  ATTACHMENTS_PER_QUESTION,
  validateAttachment,
} from '@/lib/domain/assistant/attachment-rules';
import {
  deriveConversationTitle,
  type AgentAttachment,
  type AgentConversationSummary,
  type AgentRun,
} from '@/lib/domain/assistant/questions';
import {
  askAction,
  decideAction,
  loadAgentBootstrapAction,
  openConversationAction,
  removeAttachmentAction,
  uploadAttachmentAction,
  type AskActionState,
  type AgentBootstrapState,
} from './actions';

const INITIAL: AskActionState = { error: null };

const SUGGESTED_QUESTIONS = [
  'What is at risk of being late today?',
  'What is booked with nobody assigned?',
];

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
 * (the AI-tool architecture, ADR-018); each question carries the earlier finished turns of the *same*
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
  canManageAgent,
  conversations,
  initialConversation,
  bootstrapError,
  bootstrapLoading,
  onRetry,
}: {
  organizationId: string;
  organizationName: string;
  timezone: string;
  canAnswer: boolean;
  mayAsk: boolean;
  canManageAgent: boolean;
  conversations: AgentConversationSummary[];
  initialConversation: InitialConversation | null;
  bootstrapError: string | null;
  bootstrapLoading: boolean;
  onRetry: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'default' });
  // Lifted from the bootstrap read so a write can hand History its own refreshed state directly,
  // rather than this panel going stale until it is unmounted and re-bootstrapped.
  const [conversationList, setConversationList] = useState(conversations);
  const [askError, setAskError] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{ text: string; attachments: AgentAttachment[] } | null>(null);
  // Files chosen and not yet sent. They belong to the person, not to a conversation, so they stay
  // put across New chat and History and go with the next question.
  const [drafts, setDrafts] = useState<ComposerAttachment[]>([]);
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  // Files taken back while still uploading: whatever arrives for them is deleted, never shown.
  const cancelled = useRef(new Set<string>());
  // A runtime control for the next questions, not a stored setting: whether the record open on
  // the page is named to the Agent. Durable configuration stays in Settings.
  const [includeRecord, setIncludeRecord] = useState(true);
  const [opening, startOpening] = useTransition();
  const composer = useRef<HTMLTextAreaElement>(null);
  const { agentLaunch } = useWorkspaceRail();
  const lastLaunch = useRef<number | null>(null);
  useEffect(() => {
    if (!agentLaunch || lastLaunch.current === agentLaunch.id || !composer.current) return;
    lastLaunch.current = agentLaunch.id;
    composer.current.value = [composer.current.value, agentLaunch.prompt].filter(Boolean).join('\n\n').slice(0, 2000);
    composer.current.focus();
  }, [agentLaunch]);

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
    if (!result.error && result.conversations) setConversationList(result.conversations);
  }

  const [, askFormAction, asking] = useActionState(
    async (previous: AskActionState, formData: FormData) => {
      // Shown at once, with its files and a Thinking note beneath it, until the answer is recorded.
      const sending: AgentAttachment[] = draftsRef.current
        .filter((file) => file.state === 'done' && file.documentId)
        .map((file) => ({ id: file.documentId!, fileName: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes }));
      setPendingQuestion({ text: String(formData.get('question') ?? '').trim(), attachments: sending });
      setAskError(null);
      try {
        const result = await askAction(previous, formData);
        apply(result, setAskError);
        // Sent: the files are part of the question now. If it was refused they stay, ready to try again.
        if (!result.error) setDrafts([]);
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

  function patchDraft(key: string, patch: Partial<ComposerAttachment>) {
    setDrafts((current) => current.map((file) => (file.key === key ? { ...file, ...patch } : file)));
  }

  /** Each file is checked here, at once, and again by the server — the browser is not the boundary. */
  function pickFiles(files: File[]) {
    let room = ATTACHMENTS_PER_QUESTION - draftsRef.current.filter((file) => file.state !== 'error').length;

    for (const file of files) {
      const key = crypto.randomUUID();
      const base = { key, name: file.name, sizeBytes: file.size, mimeType: file.type };
      const checked = validateAttachment(file);

      if (checked.error !== null || room <= 0) {
        const error = checked.error ?? `Attach at most ${ATTACHMENTS_PER_QUESTION} files to one question.`;
        setDrafts((current) => [...current, { ...base, state: 'error', error }]);
        continue;
      }

      room -= 1;
      setDrafts((current) => [...current, { ...base, mimeType: checked.mimeType, state: 'uploading' }]);

      const body = new FormData();
      body.set('organizationId', organizationId);
      body.set('file', file);
      void uploadAttachmentAction(body)
        .catch(() => ({ error: 'Could not upload that file. Try again.', attachment: undefined }))
        .then((result) => {
          if (cancelled.current.delete(key)) {
            // Taken back while it was on its way: it arrived anyway, so it is deleted again.
            if (result.attachment) void removeAttachmentAction(organizationId, result.attachment.id);
            return;
          }
          if (result.error || !result.attachment) {
            patchDraft(key, { state: 'error', error: result.error ?? 'Could not attach that file.' });
            return;
          }
          patchDraft(key, {
            state: 'done',
            documentId: result.attachment.id,
            name: result.attachment.fileName,
            mimeType: result.attachment.mimeType,
            sizeBytes: result.attachment.sizeBytes,
          });
        });
    }
  }

  /** Cancel an upload, or take back a stored file that has not been sent. */
  function removeDraft(key: string) {
    const file = draftsRef.current.find((candidate) => candidate.key === key);
    if (!file) return;
    setDrafts((current) => current.filter((candidate) => candidate.key !== key));
    if (file.state === 'uploading') cancelled.current.add(key);
    if (file.state === 'done' && file.documentId) void removeAttachmentAction(organizationId, file.documentId);
  }

  /** Puts text in the composer for the person to edit and send; nothing is sent from here. */
  function fillComposer(text: string) {
    if (!composer.current) return;
    composer.current.value = text.slice(0, 2000);
    composer.current.dispatchEvent(new Event('input', { bubbles: true }));
    composer.current.focus();
  }

  function newChat() {
    setAskError(null);
    setDecideError(null);
    setView({ kind: 'new' });
    composer.current?.focus();
  }

  const title = shown
    ? (conversationList.find((conversation) => conversation.id === shown.id)?.title ??
      deriveConversationTitle(shown.runs.at(-1)?.question ?? 'New chat'))
    : 'New chat';

  const facts = [
    { label: 'Business', value: organizationName },
    ...(viewing.workspace ? [{ label: 'Current workspace', value: viewing.workspace }] : []),
    ...(viewing.recordId && viewing.workspace
      ? [
          {
            label: 'Open record',
            value: includeRecord ? `A record in ${viewing.workspace}` : 'Not shared — turned off below',
          },
        ]
      : []),
    { label: 'Business time zone', value: timezone },
  ];

  const hasTurns = (shown?.runs.length ?? 0) > 0 || pendingQuestion !== null;

  return (
    <AgentPanelFrame>
      {bootstrapError ? <BootstrapError message={bootstrapError} loading={bootstrapLoading} onRetry={onRetry} /> : null}
      <AgentConversationHeader
        title={title}
        conversations={conversationList}
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
          onReuseQuestion={fillComposer}
        />
      ) : (
        <div aria-busy={opening} className="min-h-0 flex-1">
          <AgentEmptyConversation
            title="Ask about this business"
            prompts={mayAsk && canAnswer ? SUGGESTED_QUESTIONS : []}
            onPickPrompt={fillComposer}
          />
        </div>
      )}

      {!canAnswer ? (
        // The conversation stays: History, past transcripts and the composer are all still there.
        // Only asking is off, and the panel says so where the person would type. A business is not
        // told why (GOLD's own AI provider is not its concern).
        <p role="status" className="shrink-0 px-4 pb-2 text-sm text-muted">
          Agent is currently unavailable, so questions cannot be sent right now.
        </p>
      ) : null}

      {askError ? (
        <p role="alert" className="shrink-0 px-4 pb-2 text-sm text-danger">
          {askError}
        </p>
      ) : null}

      <AgentComposer
        formAction={askFormAction}
        textareaRef={composer}
        disabled={!mayAsk || !canAnswer}
        pending={asking}
        attachments={drafts}
        canAttach={drafts.filter((file) => file.state !== 'error').length < ATTACHMENTS_PER_QUESTION}
        onPickFiles={pickFiles}
        onRemoveAttachment={removeDraft}
        placeholder={
          !canAnswer
            ? 'Ask about this business…'
            : mayAsk
              ? 'Ask about this business…'
              : 'Your role cannot ask questions here.'
        }
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
            <AgentToolPopover label="Context" icon={<SlidersHorizontal aria-hidden size={14} />} title="What the Agent sees next">
              <AgentContextFacts facts={facts} />
              <p className="text-xs text-muted">This follows the page you are on.</p>
              <div className="flex items-start gap-2 border-t border-border pt-3">
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
              {canManageAgent ? (
                <ButtonLink href={`/organizations/${organizationId}/ai/agents`} tone="secondary" size="small" className="w-fit">
                  Agent settings
                </ButtonLink>
              ) : null}
            </AgentToolPopover>
          </>
        }
      />
    </AgentPanelFrame>
  );
}

/**
 * Registers the Agent rail's content for Tenant scope, once, at the organization shell root, so
 * it survives every page's own mount/unmount as somebody navigates the business. Renders nothing
 * itself.
 *
 * Shell-time props are static only — `organizationId`, `organizationName`, `timezone`, `mayAsk`
 * and `canManageAgent` are facts the shell already read for the page around it. Everything
 * an open conversation needs (`canAnswer`, History, the latest transcript) is a *conversation*
 * fact, not a shell one, and is fetched here lazily, from `loadAgentBootstrapAction`, the first
 * time the panel is actually opened — this component mounts on every page regardless of whether
 * Agent is ever opened, so fetching eagerly here would be the same N+1-on-every-page-load the shell
 * was just relieved of, moved one component down rather than removed.
 */
type TenantAgentRailProps = {
  organizationId: string;
  organizationName: string;
  timezone: string;
  mayAsk: boolean;
  canManageAgent: boolean;
};

export function TenantAgentRail(props: TenantAgentRailProps) {
  // Scope both cached history and pending requests to this organization.
  return <TenantAgentBootstrap key={props.organizationId} {...props} />;
}

function BootstrapError({ message, loading, onRetry }: { message: string; loading: boolean; onRetry: () => void }) {
  return (
    <div className="shrink-0 space-y-2 px-4 py-3">
      <p role="alert" className="text-sm text-danger">{message}</p>
      <Button type="button" tone="secondary" size="small" disabled={loading} onClick={onRetry}>
        {loading ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}

function TenantAgentBootstrap(props: TenantAgentRailProps) {
  const { organizationId, organizationName, timezone, mayAsk, canManageAgent } = props;

  // The same lazy-mount rule `AgentPanel` applies to whether the panel's content is shown at all:
  // here it gates whether this rail's own data fetch ever runs. `agentOpen` flips as soon as
  // somebody opens the panel; `everOpened` keeps the fetch from repeating on every close/reopen.
  const { agentOpen } = useWorkspaceRail();
  const [everOpened, setEverOpened] = useState(false);
  if (agentOpen && !everOpened) setEverOpened(true);

  const [bootstrap, setBootstrap] = useState<{
    status: 'loading' | 'success' | 'failure';
    data: AgentBootstrapState | null;
    error: string | null;
  }>({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setBootstrap((current) => ({ ...current, status: 'loading' }));
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!everOpened) return;
    let active = true;
    async function load() {
      try {
        const result = await loadAgentBootstrapAction(organizationId);
        if (!active) return;
        setBootstrap((current) => result.error
          ? { status: 'failure', data: current.data, error: result.error }
          : { status: 'success', data: result, error: result.identityError ?? null });
      } catch {
        if (active) setBootstrap((current) => ({
          ...current, status: 'failure', error: 'Could not connect to Agent. Try again.',
        }));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [everOpened, attempt, organizationId]);

  // Memoized so `useAgentContent`'s effect — keyed on this element's identity — runs once rather
  // than on every re-render this component takes as a `RailContext` consumer (it re-renders
  // whenever *any* rail state changes, including its own registration taking effect). Keyed by
  // business so a selection never outlives switching to another one.
  const content = useMemo(() => {
    if (!everOpened) return null;
    if (!bootstrap.data) {
      return (
        <AgentPanelFrame>
          {bootstrap.status === 'failure' ? (
            <BootstrapError message={bootstrap.error!} loading={false} onRetry={retry} />
          ) : <div role="status" className="flex flex-1 items-center justify-center text-sm text-muted">
            Loading…
          </div>}
        </AgentPanelFrame>
      );
    }
    // Keep the panel mounted during retries so its selected conversation and draft survive.
    return (
      <TenantAgentPanel
        key={organizationId}
        organizationId={organizationId}
        organizationName={organizationName}
        timezone={timezone}
        canAnswer={bootstrap.status === 'success' && bootstrap.data.canAnswer}
        mayAsk={mayAsk}
        canManageAgent={canManageAgent}
        conversations={bootstrap.data.conversations}
        initialConversation={bootstrap.data.initialConversation}
        bootstrapError={bootstrap.error}
        bootstrapLoading={bootstrap.status === 'loading'}
        onRetry={retry}
      />
    );
  }, [everOpened, bootstrap, organizationId, organizationName, timezone, mayAsk, canManageAgent, retry]);

  useAgentContent(content);
  return null;
}
