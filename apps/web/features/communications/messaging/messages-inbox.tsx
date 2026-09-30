'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { EmptyState } from '@/components/surfaces/section';
import { ErrorText, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import {
  listConversationsAction,
  listMessagesAction,
  markConversationReadAction,
  sendMessageAction,
} from '@/app/organizations/[organizationId]/comms/messages/actions';
import type { Conversation, Message } from '@/lib/domain/reception/messaging';

type NumberOption = { id: string; e164: string; label: string | null };

const STATUS_LABEL: Record<string, string> = {
  queued: 'Sending…',
  sending: 'Sending…',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  undelivered: 'Failed',
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function MessagesInbox({ organizationId, numbers, mayCompose }: {
  organizationId: string;
  numbers: NumberOption[];
  mayCompose: boolean;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTo, setNewTo] = useState('');
  const [newNumberId, setNewNumberId] = useState(numbers[0]?.id ?? '');
  const [composingNew, setComposingNew] = useState(false);

  useEffect(() => {
    listConversationsAction(organizationId).then((result) => {
      if (result.ok) setConversations(result.data);
    });
  }, [organizationId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    listMessagesAction(organizationId, selectedId).then((result) => {
      if (!cancelled && result.ok) setMessages(result.data);
    });
    markConversationReadAction(organizationId, selectedId).then(() => {
      if (!cancelled) setConversations((prev) => prev.map((row) => (row.id === selectedId ? { ...row, unread: false } : row)));
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId, selectedId]);

  const selected = conversations.find((row) => row.id === selectedId) ?? null;

  const send = async () => {
    const text = body.trim();
    if (!text) return;

    setSending(true);
    setError(null);

    const to = composingNew ? newTo.trim() : (selected?.externalNumber ?? '');
    const phoneNumberId = composingNew ? newNumberId : selected?.phoneNumberId;
    const fromNumber = numbers.find((number) => number.id === phoneNumberId)?.e164;

    if (!to || !phoneNumberId || !fromNumber) {
      setSending(false);
      setError('Choose a number to send from.');
      return;
    }

    const result = await sendMessageAction(organizationId, {
      phoneNumberId,
      fromNumber,
      toNumber: to,
      body: text,
      idempotencyKey: crypto.randomUUID(),
    });
    setSending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setBody('');
    setComposingNew(false);
    setNewTo('');
    setSelectedId(result.data.conversationId);
    const refreshed = await listConversationsAction(organizationId);
    if (refreshed.ok) setConversations(refreshed.data);
    const thread = await listMessagesAction(organizationId, result.data.conversationId);
    if (thread.ok) setMessages(thread.data);
  };

  if (conversations.length === 0 && !composingNew) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <EmptyState>No conversations yet.</EmptyState>
        {mayCompose ? <Button type="button" onClick={() => setComposingNew(true)}>New message</Button> : null}
      </div>
    );
  }

  return (
    <div className="flex h-[70vh] overflow-hidden rounded-lg border border-border">
      <div className="flex w-72 flex-col border-r border-border">
        {mayCompose ? (
          <div className="border-b border-border p-2">
            <Button type="button" tone="secondary" size="small" className="w-full" onClick={() => { setComposingNew(true); setSelectedId(null); }}>
              New message
            </Button>
          </div>
        ) : null}
        <ul className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => { setSelectedId(conversation.id); setComposingNew(false); }}
                className={`w-full border-b border-border px-3 py-2 text-left hover:bg-hover ${selectedId === conversation.id ? 'bg-hover' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={conversation.unread ? 'font-semibold' : 'font-medium'}>{conversation.externalNumber}</span>
                  <span className="shrink-0 text-xs text-muted">{relativeTime(conversation.lastMessageAt)}</span>
                </div>
                <div className="truncate text-sm text-muted">{conversation.lastMessagePreview || '—'}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-1 flex-col">
        {composingNew ? (
          <div className="flex items-center gap-2 border-b border-border p-3">
            <span className="text-sm text-muted">To</span>
            <TextInput size="small" placeholder="+14165550142" value={newTo} onChange={(event) => setNewTo(event.target.value)} className="w-40" />
            <span className="text-sm text-muted">From</span>
            <SelectInput size="small" value={newNumberId} onChange={(event) => setNewNumberId(event.target.value)}>
              {numbers.map((number) => (
                <option key={number.id} value={number.id}>{number.label ? `${number.label} · ${number.e164}` : number.e164}</option>
              ))}
            </SelectInput>
          </div>
        ) : selected ? (
          <div className="border-b border-border p-3">
            <div className="font-medium">{selected.externalNumber}</div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a conversation</div>
        )}

        {(selected || composingNew) ? (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${message.direction === 'outbound' ? 'bg-accent text-on-accent' : 'bg-hover'}`}>
                    <div>{message.body}</div>
                    <div className={`mt-1 flex items-center gap-1 text-xs ${message.direction === 'outbound' ? 'text-on-accent/80' : 'text-muted'}`}>
                      {relativeTime(message.createdAt)}
                      {message.direction === 'outbound' ? (
                        <>
                          {' · '}
                          {message.status === 'failed' || message.status === 'undelivered' ? <AlertTriangle className="inline h-3 w-3" aria-hidden /> : null}
                          {STATUS_LABEL[message.status] ?? message.status}
                        </>
                      ) : null}
                    </div>
                    {message.failureReason ? <div className="mt-1 text-xs text-danger">{message.failureReason}</div> : null}
                  </div>
                </div>
              ))}
            </div>

            {mayCompose ? (
              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <TextArea
                    size="small"
                    placeholder="Write a message…"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="flex-1"
                    rows={1}
                  />
                  <Button type="button" onClick={send} disabled={sending || !body.trim()}>
                    <Send aria-hidden /> Send
                  </Button>
                </div>
                {error ? <ErrorText className="mt-1">{error}</ErrorText> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
