'use client';

import { AlertTriangle, Paperclip } from 'lucide-react';
import { Button } from '@/components/controls/button';
import type { EmailThreadMessage } from '@/lib/domain/email/messages';
import type { Message } from '@/lib/domain/reception/messaging';
import { PROBLEM_STATUSES, STATUS_LABEL, formatSize, relativeTime } from './format';

/**
 * How one message looks, per channel. The Inbox unifies the conversation, not the messages: a text is a
 * short bubble with a delivery word, an email is a card with its sender, subject, attachments and
 * sanitized body. The two share a timeline and nothing else.
 */

export function SmsBubble({ message }: { message: Message }) {
  const outbound = message.direction === 'outbound';
  const problem = PROBLEM_STATUSES.has(message.status);
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm md:max-w-[70%] ${outbound ? 'bg-accent text-on-accent' : 'bg-hover'}`}>
        <div className="whitespace-pre-wrap break-words">{message.body}</div>
        <div className={`mt-1 flex items-center gap-1 text-xs ${outbound ? 'text-on-accent/80' : 'text-muted'}`}>
          {relativeTime(message.createdAt)}
          {outbound ? (
            <>
              {' · '}
              {problem ? <AlertTriangle className="inline h-3 w-3" aria-hidden /> : null}
              {STATUS_LABEL[message.status] ?? message.status}
            </>
          ) : null}
        </div>
        {message.failureReason ? <div className="mt-1 text-xs text-danger">{message.failureReason}</div> : null}
      </div>
    </div>
  );
}

export function EmailCard({ organizationId, message, onRetry }: { organizationId: string; message: EmailThreadMessage; onRetry: (id: string) => void }) {
  const outbound = message.direction === 'outbound';
  const problem = PROBLEM_STATUSES.has(message.status);
  return (
    <article className={`rounded-lg border p-3 text-sm ${outbound ? 'border-accent/40 bg-hover' : 'border-border'}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="truncate font-medium">{outbound ? 'You' : message.from}</div>
          <div className="truncate text-xs text-muted">{outbound ? `To ${message.to.join(', ')}` : `From ${message.from}`}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs text-muted">
          <span>{relativeTime(message.createdAt)}</span>
          {outbound ? (
            <>
              <span aria-hidden>·</span>
              {problem ? <AlertTriangle className="h-3 w-3 text-danger" aria-hidden /> : null}
              <span className={problem ? 'text-danger' : undefined}>{STATUS_LABEL[message.status] ?? message.status}</span>
            </>
          ) : null}
        </div>
      </header>

      {message.subject ? <div className="mt-2 font-medium">{message.subject}</div> : null}

      {message.safeHtml ? (
        // `safeHtml` is the only HTML that reaches this component: it was sanitized on the server by
        // `sanitizeEmailHtml` (allowlist; no scripts, handlers, images or unsafe links).
        <div
          className="mt-2 max-w-full overflow-x-auto break-words [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3"
          dangerouslySetInnerHTML={{ __html: message.safeHtml }}
        />
      ) : (
        <div className="mt-2 whitespace-pre-wrap break-words">{message.text}</div>
      )}

      {message.attachments.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
          {message.attachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center gap-2 text-xs">
              <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
              {attachment.state === 'stored' ? (
                <a className="underline" href={`/organizations/${organizationId}/comms/attachments/${attachment.id}`} download>{attachment.filename}</a>
              ) : (
                <span>{attachment.filename}</span>
              )}
              <span className="text-muted">{formatSize(attachment.sizeBytes)}</span>
              {attachment.state === 'pending' ? <span className="text-muted">Still being saved</span> : null}
              {attachment.state === 'rejected' ? <span className="text-danger">Not kept: {attachment.rejectionReason ?? 'it could not be saved'}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {outbound && message.failureReason && (problem || message.status === 'queued') ? <div className="mt-2 text-xs text-danger">{message.failureReason}</div> : null}
      {outbound && message.status === 'queued' ? (
        <div className="mt-2">
          <Button type="button" size="small" tone="secondary" onClick={() => onRetry(message.id)}>Try sending again</Button>
        </div>
      ) : null}
    </article>
  );
}
