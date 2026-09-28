'use client';

import { useEffect, useState } from 'react';
import { Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play, UserPlus, UserX } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { TextInput } from '@/components/controls/inputs';
import {
  addParticipantAction,
  holdParticipantAction,
  listCallParticipantsAction,
  removeParticipantAction,
} from '@/app/organizations/[organizationId]/calls/conference-actions';
import type { Participant } from '@/lib/domain/reception/conference';
import { useTelephoneDevice } from './telephone-device';

const CALL_STATE_LABEL: Record<string, string> = { ringing: 'Ringing', in_progress: 'In call', closed: 'Ended' };

function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The persistent dock: contact, number, duration, identity, participant state, call state and
 * controls, on screen from any page while a call is live — a live call must not disappear because
 * the operator navigated to look something up mid-conversation.
 *
 * **Unverified against a live call**, same as `telephone-device.tsx`: the wiring to every server
 * action is real, but no browser has driven this against a real conference yet.
 */
export function ActiveCallDock({ organizationId }: { organizationId: string }) {
  const { status, error, activeCall, incoming, hangUp, toggleMute, sendDigits } = useTelephoneDevice();
  const [now, setNow] = useState(() => Date.now());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [transferNumber, setTransferNumber] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [keypadOpen, setKeypadOpen] = useState(false);

  useEffect(() => {
    if (!activeCall) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeCall]);

  const activeCallId = activeCall?.callId ?? null;

  useEffect(() => {
    if (!activeCallId) return undefined;
    let cancelled = false;
    const refresh = async () => {
      const result = await listCallParticipantsAction(organizationId, activeCallId);
      if (!cancelled && result.ok) setParticipants(result.data);
    };
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [organizationId, activeCallId]);

  if (incoming) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-4 border-t border-border bg-surface px-6 py-3 shadow-lg">
        <span className="font-medium">Incoming call</span>
        <div className="flex gap-2">
          <Button tone="primary" onClick={incoming.accept}><Phone aria-hidden /> Answer</Button>
          <Button tone="danger" onClick={incoming.reject}><PhoneOff aria-hidden /> Decline</Button>
        </div>
      </div>
    );
  }

  if (!activeCall) return null;

  const run = async (key: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    setPending(key);
    setActionError(null);
    const result = await action();
    if (!result.ok) setActionError(result.error ?? 'That did not work.');
    setPending(null);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface px-6 py-3 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{activeCall.contactLabel ?? 'Call'}</span>
            <Badge tone={activeCall.status === 'in_progress' ? 'success' : 'neutral'}>{CALL_STATE_LABEL[activeCall.status]}</Badge>
            {status !== 'ready' ? <Badge tone="danger">Dialer {status}</Badge> : null}
          </div>
          <div className="text-sm text-muted">{elapsed(activeCall.startedAt, now)} · {activeCall.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            tone="secondary"
            size="small"
            onClick={toggleMute}
            aria-pressed={activeCall.muted}
          >
            {activeCall.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />} {activeCall.muted ? 'Muted' : 'Mute'}
          </Button>

          <Button tone="secondary" size="small" aria-pressed={keypadOpen} onClick={() => setKeypadOpen((open) => !open)}>
            <Grid3x3 aria-hidden /> Keypad
          </Button>

          {participants
            .filter((participant) => participant.leftAt === null && participant.party === 'customer')
            .map((participant) => (
              <Button
                key={participant.id}
                tone="secondary"
                size="small"
                disabled={pending === `hold-${participant.id}`}
                onClick={() =>
                  run(`hold-${participant.id}`, () =>
                    holdParticipantAction(organizationId, { callId: activeCall.callId!, participantId: participant.id, hold: !participant.onHold }),
                  )
                }
              >
                {participant.onHold ? <Play aria-hidden /> : <Pause aria-hidden />} {participant.onHold ? 'Resume' : 'Hold'}
              </Button>
            ))}

          <div className="flex items-center gap-1">
            <TextInput
              value={transferNumber}
              onChange={(event) => setTransferNumber(event.target.value)}
              placeholder="+14165550142"
              aria-label="Number to add or transfer to"
              className="w-40"
            />
            <Button
              tone="secondary"
              size="small"
              disabled={!transferNumber || pending === 'add'}
              onClick={() =>
                run('add', () =>
                  addParticipantAction(organizationId, { callId: activeCall.callId!, party: 'transfer_target', toNumber: transferNumber }),
                )
              }
            >
              <UserPlus aria-hidden /> Add
            </Button>
          </div>

          {participants
            .filter((participant) => participant.leftAt === null && participant.party !== 'customer')
            .map((participant) => (
              <Button
                key={participant.id}
                tone="secondary"
                size="small"
                disabled={pending === `remove-${participant.id}`}
                onClick={() =>
                  run(`remove-${participant.id}`, () =>
                    removeParticipantAction(organizationId, { callId: activeCall.callId!, participantId: participant.id }),
                  )
                }
              >
                <UserX aria-hidden /> Remove {participant.party}
              </Button>
            ))}

          <Button tone="danger" size="small" onClick={hangUp}>
            <PhoneOff aria-hidden /> Hang up
          </Button>
        </div>
      </div>

      {keypadOpen ? (
        <div className="mt-3 grid w-48 grid-cols-3 gap-1">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
            <Button key={digit} type="button" tone="secondary" size="small" onClick={() => sendDigits(digit)}>
              {digit}
            </Button>
          ))}
        </div>
      ) : null}

      {(error || actionError) ? <p className="mt-2 text-sm text-danger">{error ?? actionError}</p> : null}
    </div>
  );
}
