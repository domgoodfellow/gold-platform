'use client';

import { formatPhoneForDisplay } from '@/lib/display/phone';
import { PhoneInput } from '@/components/controls/phone-input';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { startEmailAction, startSmsAction } from '@/app/organizations/[organizationId]/comms/inbox/actions';
import { validateOutboundAttachments } from '@/lib/domain/email/attachment-limits';
import { announceInboxChange, formatSize } from './format';

type NumberOption = { id: string; e164: string; label: string | null };
type SenderOption = { id: string; address: string; displayName: string | null };

/**
 * Start a conversation with somebody new, by text or by email. Each channel keeps its own form — a text
 * needs a number to send from, an email a verified address, a subject and attachments — and each names
 * the thing it sends *as* by id (a number, an address). There is no from-field to type: the server
 * decides the number or the address from the id.
 */
export function NewConversation({
  organizationId,
  numbers,
  senders,
  initialChannel,
}: {
  organizationId: string;
  numbers: NumberOption[];
  senders: SenderOption[];
  initialChannel: 'sms' | 'email';
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [channel, setChannel] = useState<'sms' | 'email'>(initialChannel);
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? '');
  const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [key] = useState(() => crypto.randomUUID());

  const open = (conversationId: string) => {
    announceInboxChange();
    const q = params.toString();
    router.push(`/organizations/${organizationId}/comms/inbox/${conversationId}${q ? `?${q}` : ''}`);
  };

  const send = async () => {
    setError(null);
    if (!text.trim()) return;
    setBusy(true);

    if (channel === 'sms') {
      if (!numberId) {
        setBusy(false);
        return setError('Choose a number to send from.');
      }
      const result = await startSmsAction(organizationId, { phoneNumberId: numberId, toNumber: to.trim(), body: text, idempotencyKey: key });
      setBusy(false);
      return result.ok ? open(result.data.conversationId) : setError(result.error);
    }

    const problem = validateOutboundAttachments(files);
    if (problem) {
      setBusy(false);
      return setError(problem);
    }
    if (!senderId) {
      setBusy(false);
      return setError('Choose an address to send from.');
    }
    const form = new FormData();
    form.set('emailIdentityId', senderId);
    form.set('to', to);
    form.set('subject', subject);
    form.set('text', text);
    form.set('idempotencyKey', key);
    for (const file of files) form.append('files', file);
    const result = await startEmailAction(organizationId, form);
    setBusy(false);
    return result.ok ? open(result.data.conversationId) : setError(result.error);
  };

  const unavailable = channel === 'sms' ? numbers.length === 0 : senders.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-medium">New conversation</h2>
        <div className="ml-auto inline-flex overflow-hidden rounded border border-border text-xs" role="group" aria-label="Channel">
          {(['sms', 'email'] as const).map((option) => (
            <button key={option} type="button" aria-pressed={channel === option} onClick={() => { setChannel(option); setError(null); }} className={`px-3 py-1 ${channel === option ? 'bg-accent text-on-accent' : 'hover:bg-hover'}`}>
              {option === 'sms' ? 'SMS' : 'Email'}
            </button>
          ))}
        </div>
      </div>

      {unavailable ? (
        <Hint>
          {channel === 'sms'
            ? 'No number is ready to send texts from. Numbers are listed under Communications → Numbers.'
            : 'No email address is ready to send from yet. An address is named beneath a verified sending domain, in Settings → Email.'}
        </Hint>
      ) : (
        <div className="flex max-w-2xl flex-col gap-2">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-14 text-muted">From</span>
            {channel === 'sms' ? (
              <SelectInput size="small" value={numberId} onChange={(event) => setNumberId(event.target.value)} aria-label="Send from">
                {numbers.map((number) => <option key={number.id} value={number.id}>{number.label ? `${number.label} · ${formatPhoneForDisplay(number.e164)}` : formatPhoneForDisplay(number.e164)}</option>)}
              </SelectInput>
            ) : (
              <SelectInput size="small" value={senderId} onChange={(event) => setSenderId(event.target.value)} aria-label="Send from">
                {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.displayName ? `${sender.displayName} · ${sender.address}` : sender.address}</option>)}
              </SelectInput>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="w-14 text-muted">To</span>
            {channel === 'email' ? <TextInput size="small" type="email" placeholder="person@example.com" value={to} onChange={(event) => setTo(event.target.value)} className="min-w-0 flex-1" aria-label="To" /> : <PhoneInput size="small" placeholder="+14165550142" value={to} onChange={(event) => setTo(event.target.value)} className="min-w-0 flex-1" aria-label="To" />}
          </label>
          {channel === 'email' ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="w-14 text-muted">Subject</span>
              <TextInput size="small" value={subject} onChange={(event) => setSubject(event.target.value)} className="min-w-0 flex-1" aria-label="Subject" />
            </label>
          ) : null}
          <TextArea size="small" placeholder={channel === 'email' ? 'Write your email…' : 'Write a text…'} value={text} onChange={(event) => setText(event.target.value)} rows={channel === 'email' ? 8 : 4} className="w-full" aria-label="Message" />
          <div className="flex flex-wrap items-end justify-between gap-2">
            {channel === 'email' ? (
              <div className="flex flex-wrap items-center gap-2">
                <input ref={picker} type="file" multiple className="sr-only" aria-label="Attach files" onChange={(event) => { setFiles([...files, ...Array.from(event.target.files ?? [])]); event.target.value = ''; }} />
                <Button type="button" tone="secondary" size="small" onClick={() => picker.current?.click()}><Paperclip aria-hidden /> Attach</Button>
                {files.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs">
                    <span className="max-w-40 truncate">{file.name}</span>
                    <span className="text-muted">{formatSize(file.size)}</span>
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X className="h-3 w-3" aria-hidden /></button>
                  </span>
                ))}
              </div>
            ) : <span />}
            <Button type="button" onClick={send} disabled={busy || !text.trim()}><Send aria-hidden /> {busy ? 'Sending…' : 'Send'}</Button>
          </div>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </div>
      )}
    </div>
  );
}
