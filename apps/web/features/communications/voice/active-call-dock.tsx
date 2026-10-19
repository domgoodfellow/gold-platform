'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, ExternalLink, Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play, UserPlus, UserX } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { MOBILE_NAV_HEIGHT_STYLE } from '@/components/layout/workspace-geometry';
import {
  addParticipantAction,
  cancelTransferAction,
  coldTransferAction,
  completeTransferAction,
  holdParticipantAction,
  leaveCallAction,
  listCallParticipantsAction,
  removeParticipantAction,
  warmTransferAction,
  type Roster,
} from '@/app/organizations/[organizationId]/calls/conference-actions';
import type { Participant } from '@/lib/domain/reception/conference';
import { useTelephoneDevice } from './telephone-device';
import { useDialerPopout } from './dialer-popout-context';

const CALL_STATE_LABEL: Record<string, string> = { ringing: 'Ringing', in_progress: 'In call', closed: 'Ended' };
const PARTY_LABEL: Record<Participant['party'], string> = {
  agent: 'Colleague',
  customer: 'Caller',
  supervisor: 'Supervisor',
  transfer_target: 'Transfer',
};

function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function legState(participant: Participant): string {
  if (participant.onHold) return 'On hold';
  return participant.status === 'in_progress' ? 'Connected' : 'Ringing';
}

type Panel = 'keypad' | 'add' | 'transfer' | null;

/**
 * The persistent dock: who is on the call, its state, how long, and what this person can do to it.
 * It is on screen from any page while a call is live — a live call must not disappear because the
 * operator navigated to look something up mid-conversation.
 *
 * **Every control tells the truth about what it did.** A control that reaches the carrier waits for
 * the carrier, and shows the refusal when it refuses; nothing is flagged held, transferred or gone
 * on the strength of a click. The roster is read from the call's own participants, not remembered
 * here, so a person who joins or leaves from somewhere else is shown as they are.
 *
 * **Leaving and ending are different buttons for the same click.** When a colleague or a transfer
 * destination is staying on, this person's telephone is told not to close the room and the button
 * says *Leave call*; when they are the last one from the business, it hangs up the call and says
 * *End call*.
 *
 * **Not verified against a live carrier.** Mute and the keypad act on this browser's own
 * telephone; hold, add, transfer and removal go through the server to the carrier.
 */
export function ActiveCallDock({ organizationId, placement = 'dock' }: { organizationId: string; placement?: 'dock' | 'inline' }) {
  const { status, error, activeCall, incoming, hangUp, toggleMute, sendDigits } = useTelephoneDevice();
  const popout = useDialerPopout();
  const [now, setNow] = useState(() => Date.now());
  const [roster, setRoster] = useState<Roster>({ participants: [], ownMembershipId: null });
  const [number, setNumber] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const container = popout?.container;
  const surfaceClass = container
    ? 'order-2 m-4 rounded-lg border border-border bg-surface p-4'
    : placement === 'inline'
      ? 'rounded-lg border border-border bg-surface p-4'
      : 'fixed inset-x-0 bottom-(--mobile-nav-height) z-50 max-h-[70dvh] overflow-y-auto border-t border-border bg-surface px-4 py-3 shadow-lg md:bottom-0 md:px-6';
  const renderSurface = (content: ReactNode) => container && placement === 'dock' ? createPortal(content, container) : content;

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
      if (!cancelled && result.ok) setRoster(result.data);
    };
    void refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [organizationId, activeCallId]);

  // One live presentation owns the call: the pop-out window when it is open, else the Dialer page when it is hosting, else the dock.
  if (placement === 'dock' && !container && popout?.inlineHost) return null;
  if (placement === 'inline' && container) {
    if (!incoming && !activeCall) return null;
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
        <p>{incoming ? 'An incoming call' : 'This call'} is in the separate dialer window.</p>
        <Button tone="secondary" size="small" onClick={() => popout?.open()}><ExternalLink aria-hidden /> Show dialer window</Button>
      </div>
    );
  }

  if (incoming) {
    return renderSurface(
      <div
        style={placement === 'dock' ? MOBILE_NAV_HEIGHT_STYLE : undefined}
        className={`${surfaceClass} flex flex-wrap items-center justify-between gap-3`}
      >
        <span className="font-medium">Incoming call</span>
        <div className="flex gap-2">
          <Button tone="primary" onClick={incoming.accept}><Phone aria-hidden /> Answer</Button>
          <Button tone="danger" onClick={incoming.reject}><PhoneOff aria-hidden /> Decline</Button>
        </div>
      </div>
    );
  }

  if (!activeCall) return null;

  const callId = activeCall.callId;
  const live = roster.participants.filter((participant) => participant.leftAt === null);
  const customer = live.find((participant) => participant.party === 'customer');
  const target = live.find((participant) => participant.party === 'transfer_target');
  const staying = live.some(
    (participant) =>
      participant.party !== 'customer' && participant.status === 'in_progress' && participant.membershipId !== roster.ownMembershipId,
  );
  const transferring = target !== undefined && customer?.onHold === true;

  const run = async (key: string, action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setPending(key);
    setActionError(null);
    try {
      const result = await action();
      if (!result.ok) setActionError(result.error ?? 'That did not work.');
      else after?.();
    } finally {
      setPending(null);
    }
    if (callId) {
      const refreshed = await listCallParticipantsAction(organizationId, callId);
      if (refreshed.ok) setRoster(refreshed.data);
    }
  };

  const leaveOrEnd = () => {
    if (!callId || !staying) {
      hangUp();
      return;
    }
    void run('leave', () => leaveCallAction(organizationId, { callId }), hangUp);
  };

  const connected = activeCall.status === 'in_progress';

  return renderSurface(
    <div
      style={placement === 'dock' ? MOBILE_NAV_HEIGHT_STYLE : undefined}
      className={surfaceClass}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{activeCall.contactLabel ?? 'Call'}</span>
            <Badge tone={connected ? 'success' : 'neutral'}>{CALL_STATE_LABEL[activeCall.status]}</Badge>
            {status !== 'ready' ? <Badge tone="danger">Dialer {status}</Badge> : null}
          </div>
          <div className="text-sm text-muted">
            {elapsed(activeCall.startedAt, now)} · {activeCall.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}
          </div>
        </div>

        <div className={container ? 'grid w-full grid-cols-2 gap-2' : 'flex flex-wrap items-center gap-2'}>
          <Button tone="secondary" size="small" onClick={toggleMute} aria-pressed={activeCall.muted}>
            {activeCall.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />} {activeCall.muted ? 'Unmute' : 'Mute'}
          </Button>

          {callId && customer ? (
            <Button
              tone="secondary"
              size="small"
              aria-pressed={customer.onHold}
              disabled={pending === 'hold' || !customer.connectable}
              onClick={() => run('hold', () => holdParticipantAction(organizationId, { callId, participantId: customer.id, hold: !customer.onHold }))}
            >
              {customer.onHold ? <Play aria-hidden /> : <Pause aria-hidden />} {customer.onHold ? 'Resume caller' : 'Hold caller'}
            </Button>
          ) : null}

          <Button tone="secondary" size="small" aria-pressed={panel === 'keypad'} onClick={() => setPanel(panel === 'keypad' ? null : 'keypad')}>
            <Grid3x3 aria-hidden /> Keypad
          </Button>
          <Button tone="secondary" size="small" aria-pressed={panel === 'add'} onClick={() => setPanel(panel === 'add' ? null : 'add')}>
            <UserPlus aria-hidden /> Add
          </Button>
          <Button tone="secondary" size="small" aria-pressed={panel === 'transfer'} onClick={() => setPanel(panel === 'transfer' ? null : 'transfer')}>
            <ArrowRightLeft aria-hidden /> Transfer
          </Button>

          <Button tone="danger" size="small" disabled={pending === 'leave'} onClick={leaveOrEnd}>
            <PhoneOff aria-hidden /> {staying ? 'Leave call' : 'End call'}
          </Button>
          {!container && popout ? <Button tone="secondary" size="small" data-dialer-popout-trigger onClick={() => popout.open()}><ExternalLink aria-hidden /> Pop out dialer</Button> : null}
        </div>
      </div>

      {live.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Who is on this call">
          {live.map((participant) => (
            <li key={participant.id} className="flex items-center gap-2 rounded border border-border px-2 py-1">
              <span>{participant.membershipId !== null && participant.membershipId === roster.ownMembershipId ? 'You' : PARTY_LABEL[participant.party]}</span>
              <span className="text-muted">{legState(participant)}</span>
              {callId && (participant.party === 'transfer_target' || participant.party === 'supervisor') ? (
                <Button
                  tone="text"
                  size="tiny"
                  disabled={pending === `remove-${participant.id}`}
                  onClick={() => run(`remove-${participant.id}`, () => removeParticipantAction(organizationId, { callId, participantId: participant.id }))}
                >
                  <UserX aria-hidden /> Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {transferring && callId ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
            {target.status === 'in_progress' ? 'The person you are transferring to is on the line. The caller is on hold.' : 'Ringing the person you are transferring to. The caller is on hold.'}
          </span>
          <Button
            size="small"
            disabled={target.status !== 'in_progress' || pending === 'complete'}
            onClick={() => run('complete', () => completeTransferAction(organizationId, { callId }), hangUp)}
          >
            Complete handoff
          </Button>
          <Button tone="secondary" size="small" disabled={pending === 'cancel'} onClick={() => run('cancel', () => cancelTransferAction(organizationId, { callId }))}>
            Cancel transfer
          </Button>
        </div>
      ) : null}

      {panel === 'keypad' ? (
        <div className="mt-3 grid w-48 grid-cols-3 gap-1">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
            <Button key={digit} type="button" tone="secondary" size="small" onClick={() => sendDigits(digit)}>
              {digit}
            </Button>
          ))}
        </div>
      ) : null}

      {panel === 'add' || panel === 'transfer' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TextInput
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            type="tel"
            inputMode="tel"
            placeholder="+14165550142"
            aria-label={panel === 'add' ? 'Number to add to the call' : 'Number to transfer to'}
            className="w-44"
          />
          {callId && panel === 'add' ? (
            <Button size="small" disabled={!number || pending === 'add'} onClick={() => run('add', () => addParticipantAction(organizationId, { callId, toNumber: number }), () => setNumber(''))}>
              Add to call
            </Button>
          ) : null}
          {callId && panel === 'transfer' ? (
            <>
              <Button size="small" disabled={!number || pending === 'warm'} onClick={() => run('warm', () => warmTransferAction(organizationId, { callId, toNumber: number }), () => setNumber(''))}>
                Warm transfer
              </Button>
              <Button
                size="small"
                tone="secondary"
                disabled={!number || pending === 'cold'}
                onClick={() => run('cold', () => coldTransferAction(organizationId, { callId, toNumber: number }), hangUp)}
              >
                {pending === 'cold' ? 'Waiting for an answer…' : 'Hand off now'}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {error || actionError ? <ErrorText className="mt-2">{error ?? actionError}</ErrorText> : null}
      {!container && popout?.error ? <ErrorText className="mt-2">{popout.error}</ErrorText> : null}
    </div>
  );
}
