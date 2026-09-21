'use client';

import { useState, type ReactNode } from 'react';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@gold/ui/components/item';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@gold/ui/components/empty';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { Bot, History, MessagesSquare, Plus, Radar } from 'lucide-react';
import { cx } from '@/components/class-names';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  ACTION_LABELS,
  type AgentConversationSummary,
  type AgentRun,
} from '@/lib/domain/assistant/questions';
import { formatRecent } from './recent-time';

/**
 * The Agent presentation grammar, shared by Tenant scope and Platform scope alike (constraints.md
 * — the shell/context correction): Chat, Context and Activity tabs, message bubbles, the
 * unavailable-vs-empty distinction. Neither scope gets its own chat UI; only the data and the
 * capability check differ, supplied by `TenantAgentRail`/`PlatformAgentRail`.
 */

/** One row of "what the Agent currently knows it is looking at" — a business, a workspace, a
 * selected record. Both scopes render the same `Item` list; only the rows differ. */
export function AgentContextList({ items }: { items: { title: string; description: string }[] }) {
  return (
    <div className="p-4">
      <ItemGroup>
        {items.map((item) => (
          <Item key={item.title} variant="outline">
            <ItemContent>
              <ItemTitle>{item.title}</ItemTitle>
              <ItemDescription>{item.description}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}

/**
 * The strip under the Chat / Context / Activity tabs: History on the left, New chat on the right.
 * Presentation only — which conversation is current, and what opening or starting one does, is
 * the scope's to say. `currentId` is null for a New chat that has not sent its first question.
 */
export function AgentChatToolbar({
  conversations,
  currentId,
  onOpen,
  onNewChat,
}: {
  conversations: AgentConversationSummary[];
  currentId: string | null;
  onOpen: (conversationId: string) => void;
  onNewChat: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center justify-between px-4 pt-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" tone="secondary" size="small" className="gap-1.5">
            <History aria-hidden size={14} />
            History
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">No conversations yet.</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
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

      <Button type="button" tone="secondary" size="small" className="gap-1.5" onClick={onNewChat}>
        <Plus aria-hidden size={14} />
        New chat
      </Button>
    </div>
  );
}

/** The tool timeline — each run's own tool calls, never the rows they read (D34). Shared as-is:
 * an `AgentRun`'s `tools` shape carries nothing organization- or platform-specific. Pass it one
 * conversation's runs, not everything a person has ever asked. */
export function AgentActivityList({ runs }: { runs: AgentRun[] }) {
  const calls = runs.flatMap((run) => run.tools.map((call) => ({ runId: run.id, occurredAt: run.occurredAt, ...call })));

  if (calls.length === 0) {
    return (
      <Empty className="border-none py-8">
        <EmptyMedia variant="icon"><Radar aria-hidden /></EmptyMedia>
        <EmptyTitle>No activity yet</EmptyTitle>
        <EmptyDescription>Tool calls the assistant makes while answering appear here.</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="p-4">
      <ItemGroup>
        {calls.map((call, index) => (
          <Item key={`${call.runId}-${index}`} variant="outline" size="sm">
            <ItemContent>
              <ItemTitle>{call.tool}</ItemTitle>
              <ItemDescription>
                {call.error ? 'Refused' : `${call.rows} rows`} · {new Date(call.occurredAt).toLocaleString()}
              </ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}

/**
 * **Infrastructure unavailable — never confused with "no conversation yet".** A blank composer
 * would let somebody type a question into a deployment that cannot answer it; this is the
 * deliberate status surface instead (item 8 of the shell/context correction): what's wrong, and
 * — only when there's a real next action — a link straight to it.
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

/** Zero conversations, infrastructure genuinely available — the composer is the point, not an empty box. */
export function AgentEmptyConversation({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="border-none py-8">
      <EmptyMedia variant="icon"><Bot aria-hidden /></EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </Empty>
  );
}

/** One conversation's bubbles — question, answer/refusal/failure, and a pending proposed action. */
export function AgentConversation({
  runs,
  decideFormAction,
  decidePending,
  decideError,
  scopeIdHiddenField,
}: {
  runs: AgentRun[];
  decideFormAction: (formData: FormData) => void;
  decidePending: boolean;
  decideError: string | null;
  /** The one hidden field a decide-action needs beyond `runId` — tenant scope carries
   * `organizationId`; platform scope carries none. `null` renders nothing. */
  scopeIdHiddenField: ReactNode;
}) {
  return (
    <>
      {[...runs].reverse().map((run) => (
        <div key={run.id} className="flex flex-col gap-2">
          <div className="ml-auto max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">{run.question}</div>
          {run.outcome === 'answered' ? (
            <div className="mr-auto max-w-[85%] whitespace-pre-wrap rounded-lg border border-border px-3 py-2 text-sm">
              {run.answer}
            </div>
          ) : null}
          {run.outcome === 'unanswered' ? (
            <div className="mr-auto max-w-[85%] rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
              Nothing came back — there was no answer to be had from what this platform can look at.
            </div>
          ) : null}
          {run.outcome === 'failed' ? <ErrorText className="mr-auto max-w-[85%]">{run.detail}</ErrorText> : null}

          {run.proposedAction && run.actionOutcome === 'pending' ? (
            <form action={decideFormAction} className="mr-auto flex max-w-[85%] flex-col gap-2 rounded-lg border border-border p-2">
              {scopeIdHiddenField}
              <input type="hidden" name="runId" value={run.id} />
              <p className="text-xs font-medium">{ACTION_LABELS[run.proposedAction.name] ?? run.proposedAction.name}</p>
              <p className="text-xs text-muted">{run.proposedAction.because}</p>
              <div className="flex gap-2">
                <ActionButton name="decision" value="carry-out" pending={decidePending} label="Do it" />
                <ActionButton name="decision" value="decline" pending={decidePending} label="No" />
              </div>
              {decideError ? <ErrorText role="alert">{decideError}</ErrorText> : null}
            </form>
          ) : null}
        </div>
      ))}
    </>
  );
}

function ActionButton({ name, value, pending, label }: { name: string; value: string; pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover disabled:opacity-50"
    >
      {pending && value === 'carry-out' ? 'Working…' : label}
    </button>
  );
}

export function AgentTabs({
  chat,
  context,
  activity,
}: {
  chat: ReactNode;
  context: ReactNode;
  activity: ReactNode;
}) {
  return (
    <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList className="px-4 pt-2">
        <TabsTrigger value="chat" className="gap-1.5"><MessagesSquare aria-hidden size={14} />Chat</TabsTrigger>
        <TabsTrigger value="context">Context</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col">{chat}</TabsContent>
      <TabsContent value="context" className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto">{context}</TabsContent>
      <TabsContent value="activity" className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto">{activity}</TabsContent>
    </Tabs>
  );
}
