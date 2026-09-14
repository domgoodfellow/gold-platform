'use client';

import { useActionState, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@gold/ui/components/item';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@gold/ui/components/empty';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { Bot, MessagesSquare, Radar } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextArea } from '@/components/controls/inputs';
import { useAgentContent } from '@/components/containers/workspace-right-rail';
import { ACTION_LABELS, type AgentRun } from '@/lib/domain/assistant/questions';
import { AREAS, currentSegment } from '@/lib/navigation';
import { askAction, decideAction, type AskActionState } from '@/app/organizations/[organizationId]/ask/actions';

const INITIAL: AskActionState = { error: null };

/**
 * Chat, built on the same one-question-one-answer domain read as `/ask` (`askQuestion` never
 * streams and answers under the caller's own session — `constraints.md` D34). Rebuilding this as
 * a turn-by-turn conversation is Slice 9's job, once `packages/ui` carries the message vocabulary
 * for it; this proves the rail can host it and switch away from it without losing state.
 */
function AgentChat({ organizationId, runs, canAnswer, mayAsk }: { organizationId: string; runs: AgentRun[]; canAnswer: boolean; mayAsk: boolean }) {
  const [state, formAction, pending] = useActionState(askAction, INITIAL);
  const [decideState, decideFormAction, decidePending] = useActionState(decideAction, INITIAL);

  if (!canAnswer) {
    return (
      <Empty className="border-none py-8">
        <EmptyMedia variant="icon"><Bot aria-hidden /></EmptyMedia>
        <EmptyTitle>Nothing to ask yet</EmptyTitle>
        <EmptyDescription>
          This installation has nothing configured to answer questions.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {runs.length === 0 ? (
          <Empty className="border-none py-8">
            <EmptyMedia variant="icon"><Bot aria-hidden /></EmptyMedia>
            <EmptyTitle>Ask about this business</EmptyTitle>
            <EmptyDescription>What is at risk of being late today, what is booked with nobody assigned.</EmptyDescription>
          </Empty>
        ) : (
          [...runs].reverse().map((run) => (
            <div key={run.id} className="flex flex-col gap-2">
              <div className="ml-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm">{run.question}</div>
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
              {run.outcome === 'failed' ? (
                <ErrorText className="mr-auto max-w-[85%]">{run.detail}</ErrorText>
              ) : null}

              {run.proposedAction && run.actionOutcome === 'pending' ? (
                <form action={decideFormAction} className="mr-auto flex max-w-[85%] flex-col gap-2 rounded-lg border border-border p-2">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="runId" value={run.id} />
                  <p className="text-xs font-medium">{ACTION_LABELS[run.proposedAction.name] ?? run.proposedAction.name}</p>
                  <p className="text-xs text-muted">{run.proposedAction.because}</p>
                  <div className="flex gap-2">
                    <Button type="submit" name="decision" value="carry-out" disabled={decidePending} tone="secondary" size="tiny">
                      {decidePending ? 'Working…' : 'Do it'}
                    </Button>
                    <Button type="submit" name="decision" value="decline" disabled={decidePending} tone="secondary" size="tiny">
                      No
                    </Button>
                  </div>
                  {decideState.error ? <ErrorText role="alert">{decideState.error}</ErrorText> : null}
                </form>
              ) : null}
            </div>
          ))
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

/** "What is the assistant currently working with?" — real, not fabricated: the workspace this session is in and this business's name. Pinned sources are M9+ territory; nothing here invents any. */
function AgentContext({ organizationName }: { organizationName: string }) {
  const segment = currentSegment(usePathname());
  const area = AREAS.find((candidate) => candidate.segment === segment);

  return (
    <div className="p-4">
      <ItemGroup>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Business</ItemTitle>
            <ItemDescription>{organizationName}</ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Current workspace</ItemTitle>
            <ItemDescription>{area?.label ?? 'Unknown'}</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </div>
  );
}

/** The tool timeline — each run's own tool calls, never the rows they read (D34). */
function AgentActivity({ runs }: { runs: AgentRun[] }) {
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

function AgentRailContent({
  organizationId,
  organizationName,
  canAnswer,
  mayAsk,
  runs,
}: {
  organizationId: string;
  organizationName: string;
  canAnswer: boolean;
  mayAsk: boolean;
  runs: AgentRun[];
}) {
  const [tab, setTab] = useState('chat');

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList className="px-4 pt-2">
        <TabsTrigger value="chat" className="gap-1.5"><MessagesSquare aria-hidden size={14} />Chat</TabsTrigger>
        <TabsTrigger value="context">Context</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col">
        <AgentChat organizationId={organizationId} runs={runs} canAnswer={canAnswer} mayAsk={mayAsk} />
      </TabsContent>
      <TabsContent value="context" className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AgentContext organizationName={organizationName} />
      </TabsContent>
      <TabsContent value="activity" className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AgentActivity runs={runs} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Registers the Agent rail's content once, at the shell root, so it survives every page's own
 * mount/unmount as somebody navigates the business — the whole point of "Agent is a global
 * companion, not another page" (contract, workspace remediation pass). Renders nothing itself.
 */
export function AgentRail(props: {
  organizationId: string;
  organizationName: string;
  canAnswer: boolean;
  mayAsk: boolean;
  runs: AgentRun[];
}) {
  // Memoized so `useAgentContent`'s effect — keyed on this element's identity — runs once rather
  // than on every re-render this component takes as a `RailContext` consumer (it re-renders
  // whenever *any* rail state changes, including its own registration taking effect).
  const { organizationId, organizationName, canAnswer, mayAsk, runs } = props;
  const content = useMemo(
    () => (
      <AgentRailContent
        organizationId={organizationId}
        organizationName={organizationName}
        canAnswer={canAnswer}
        mayAsk={mayAsk}
        runs={runs}
      />
    ),
    [organizationId, organizationName, canAnswer, mayAsk, runs],
  );
  useAgentContent(content);
  return null;
}
