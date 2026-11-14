'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, ExternalLink, Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play, UserPlus, UserX } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { StatePill, type StatusTone } from '@/components/operational/primitives';
import { Avatar, AvatarFallback } from '@gold/ui/components/avatar';
import { ErrorText } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';
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
import { useTelephoneDevice, type DeviceStatus } from './telephone-device';
import { useDialerPopout } from './dialer-popout-context';

/**
 * Where the call stands for the person on the other end. A placed call is `ringing` until the
 * call's own roster says they answered: this browser joins the room first, so its own connection
 * is not evidence that anyone picked up.
 */
type Phase = 'ringing' | 'connected' | 'on-hold';
const PHASE: Record<Phase, { label: string; tone: StatusTone }> = {
  ringing: { label: 'Ringing', tone: 'neutral' },
  connected: { label: 'In call', tone: 'success' },
  'on-hold': { label: 'On hold', tone: 'warning' },
};
/** Said only while a call is live and this browser's telephone is not connected. */
const PHONE_FAULT: Record<Exclude<DeviceStatus, 'ready'>, string> = {
  offline: 'Phone disconnected',
  connecting: 'Reconnecting',
  error: 'Connection failed',
};
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

function initials(label: string | null): string {
  const words = (label ?? '').replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() : '#';
}

function legState(participant: Participant): string {
  if (participant.onHold) return 'On hold';
  return participant.status === 'in_progress' ? 'Connected' : 'Ringing';
}

type Panel = 'keypad' | 'add' | 'transfer' | null;

/**
 * The live call: who is on it, where it stands, how long, and what this person can do to it. One
 * component draws it in each presentation, from the one telephone the organization layout holds:
 *
 * - `dock`: the strip at the foot of every page, so a live call does not disappear because the
 *   operator navigated to look something up mid-conversation. While the pop-out window is open
 *   the same controls are drawn there instead.
 * - `console`: the Dialer page's calling workspace, where the call is the main surface.
 *
 * **Every control tells the truth about what it did.** A control that reaches the carrier waits for
 * the carrier, and shows the refusal when it refuses; nothing is flagged held, transferred or gone
 * on the strength of a click. The roster is read from the call's own participants, not remembered
 * here, so a person who joins or leaves from somewhere else is shown as they are.
 *
 * **A control is offered only when it can work.** Hold and transfer need a caller who has answered;
 * adding someone needs a call the business's own room holds. A call answered directly in this
 * browser has no room, so it offers mute, the keypad and hanging up.
 *
 * **Leaving and ending are different buttons for the same click.** When a colleague or a transfer
 * destination is staying on, this person's telephone is told not to close the room and the button
 * says *Leave call*; when they are the last one from the business, it hangs up the call and says
 * *End call*.
 *
 * **Not verified against a live carrier.** Mute and the keypad act on this browser's own
 * telephone; hold, add, transfer and removal go through the server to the carrier.
 */
export function ActiveCallDock({ organizationId, placement = 'dock' }: { organizationId: string; placement?: 'dock' | 'console' }) {
  const { status, error, activeCall, incoming, hangUp, toggleMute, sendDigits } = useTelephoneDevice();
  const popout = useDialerPopout();
  // The server and hydration render share a placeholder; the browser clock starts after mount.
  const [now, setNow] = useState<number | null>(null);
  const [roster, setRoster] = useState<(Roster & { callId: string }) | null>(null);
  const [number, setNumber] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const container = popout?.container;
  const inWindow = !!container && placement === 'dock';
  // The pop-out window and the Dialer page give the call room; the dock is one strip.
  const roomy = inWindow || placement === 'console';
  const surfaceClass = inWindow
    ? 'order-2 p-4'
    : placement === 'console'
      ? 'p-4 @sm/calling:p-5'
      : 'fixed inset-x-0 bottom-(--mobile-nav-height) z-50 max-h-[70dvh] overflow-y-auto border-t border-border bg-surface px-4 py-3 shadow-lg md:bottom-0 md:px-6';
  const renderSurface = (content: ReactNode) => inWindow && container ? createPortal(content, container) : content;

  useEffect(() => {
    if (!activeCall) return undefined;
    const firstTick = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(firstTick); clearInterval(interval); };
  }, [activeCall]);

  const activeCallId = activeCall?.callId ?? null;

  useEffect(() => {
    if (!activeCallId) return undefined;
    let cancelled = false;
    const refresh = async () => {
      const result = await listCallParticipantsAction(organizationId, activeCallId);
      if (!cancelled && result.ok) setRoster({ ...result.data, callId: activeCallId });
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
  if (placement === 'console' && container) return null;

  if (incoming) {
    return renderSurface(
      <div
        data-slot="live-call"
        data-phase="incoming"
        style={placement === 'dock' ? MOBILE_NAV_HEIGHT_STYLE : undefined}
        className={cx(surfaceClass, 'flex flex-wrap items-center justify-between gap-3')}
      >
        <span className={roomy ? 'text-lg font-semibold' : 'font-medium'}>Incoming call</span>
        <div className="flex gap-2">
          <Button tone="primary" className={roomy ? 'h-11 px-5' : undefined} onClick={incoming.accept}><Phone aria-hidden /> Answer</Button>
          <Button tone="danger" className={roomy ? 'h-11 px-5' : undefined} onClick={incoming.reject}><PhoneOff aria-hidden /> Decline</Button>
        </div>
      </div>
    );
  }

  if (!activeCall) return null;

  const callId = activeCall.callId;
  // A roster read for an earlier call says nothing about this one.
  const known = roster && roster.callId === callId ? roster : null;
  const live = (known?.participants ?? []).filter((participant) => participant.leftAt === null);
  const customer = live.find((participant) => participant.party === 'customer');
  const target = live.find((participant) => participant.party === 'transfer_target');
  const staying = live.some(
    (participant) =>
      participant.party !== 'customer' && participant.status === 'in_progress' && participant.membershipId !== known?.ownMembershipId,
  );
  const transferring = target !== undefined && customer?.onHold === true;
  // Answered needs both ends: this telephone connected, and the roster showing the other person picked up.
  const answered = activeCall.status === 'in_progress' && customer?.status === 'in_progress';
  const phase: Phase = activeCall.status !== 'in_progress' ? 'ringing'
    : customer ? (!answered ? 'ringing' : customer.onHold ? 'on-hold' : 'connected')
    // Placed through the business's room and not yet read back: nobody is known to have answered.
    : callId && !known && activeCall.direction === 'outgoing' ? 'ringing'
    : 'connected';

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
      if (refreshed.ok) setRoster({ ...refreshed.data, callId });
    }
  };

  const leaveOrEnd = () => {
    if (!callId || !staying) {
      hangUp();
      return;
    }
    void run('leave', () => leaveCallAction(organizationId, { callId }), hangUp);
  };

  const controlSize = roomy ? 'default' : 'small';
  const tile = roomy ? 'h-16 flex-col gap-1 text-xs [&_svg]:size-5' : undefined;
  const name = formatPhoneForDisplay(activeCall.contactLabel ?? 'Call');
  const direction = activeCall.direction === 'outgoing' ? 'Outgoing' : 'Incoming';
  const duration = now === null ? '—' : elapsed(activeCall.startedAt, now);
  const pills = (
    <>
      <StatePill tone={PHASE[phase].tone}>{PHASE[phase].label}</StatePill>
      {status !== 'ready' ? <StatePill tone="danger">{PHONE_FAULT[status]}</StatePill> : null}
    </>
  );

  return renderSurface(
    <div
      data-slot="live-call"
      data-phase={phase}
      style={placement === 'dock' ? MOBILE_NAV_HEIGHT_STYLE : undefined}
      className={surfaceClass}
    >
      <div className={roomy ? 'flex flex-col gap-5' : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2'}>
        {roomy ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar className="size-14 shrink-0"><AvatarFallback className="bg-secondary text-lg font-semibold text-muted">{initials(activeCall.contactLabel)}</AvatarFallback></Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">{pills}</div>
                <p className="mt-1 truncate text-2xl font-semibold tracking-tight">{name}</p>
                <p className="text-sm text-muted">{direction}</p>
              </div>
            </div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight" aria-label="Call duration">{duration}</p>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{name}</span>
              {pills}
            </div>
            <div className="text-sm text-muted tabular-nums">{duration} · {direction}</div>
          </div>
        )}

        <div role="group" aria-label="Call controls" className={roomy ? 'grid grid-cols-3 gap-2 @min-[34rem]/calling:grid-cols-6' : 'flex flex-wrap items-center gap-2'}>
          <Button tone="secondary" size={controlSize} className={tile} onClick={toggleMute} aria-pressed={activeCall.muted}>
            {activeCall.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />} {activeCall.muted ? 'Unmute' : 'Mute'}
          </Button>

          {callId && customer ? (
            <Button
              tone="secondary"
              size={controlSize}
              className={tile}
              aria-pressed={customer.onHold}
              disabled={pending === 'hold' || !customer.connectable || !answered}
              onClick={() => run('hold', () => holdParticipantAction(organizationId, { callId, participantId: customer.id, hold: !customer.onHold }))}
            >
              {customer.onHold ? <Play aria-hidden /> : <Pause aria-hidden />} {customer.onHold ? 'Resume caller' : 'Hold caller'}
            </Button>
          ) : null}

          <Button tone="secondary" size={controlSize} className={tile} aria-pressed={panel === 'keypad'} onClick={() => setPanel(panel === 'keypad' ? null : 'keypad')}>
            <Grid3x3 aria-hidden /> Keypad
          </Button>
          {callId ? (
            <>
              <Button tone="secondary" size={controlSize} className={tile} aria-pressed={panel === 'add'} onClick={() => setPanel(panel === 'add' ? null : 'add')}>
                <UserPlus aria-hidden /> Add
              </Button>
              <Button tone="secondary" size={controlSize} className={tile} aria-pressed={panel === 'transfer'} disabled={!answered} onClick={() => setPanel(panel === 'transfer' ? null : 'transfer')}>
                <ArrowRightLeft aria-hidden /> Transfer
              </Button>
            </>
          ) : null}

          <Button tone="danger" size={controlSize} className={tile} disabled={pending === 'leave'} onClick={leaveOrEnd}>
            <PhoneOff aria-hidden /> {staying ? 'Leave call' : 'End call'}
          </Button>
          {!container && popout && placement === 'dock' ? <Button tone="secondary" size="small" data-dialer-popout-trigger onClick={() => popout.open()}><ExternalLink aria-hidden /> Pop out dialer</Button> : null}
        </div>
      </div>

      {transferring && callId ? (
        <div role="status" className={cx('flex flex-wrap items-center gap-2 text-sm', roomy ? 'mt-4' : 'mt-2')}>
          <span className="min-w-0 flex-1 text-muted">
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
        <div role="group" aria-label="Keypad tones" className={roomy ? 'mt-4 grid w-full max-w-60 grid-cols-3 gap-1.5' : 'mt-3 grid w-48 grid-cols-3 gap-1'}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
            <Button key={digit} type="button" tone="secondary" size={controlSize} className={roomy ? 'h-10 tabular-nums' : undefined} onClick={() => sendDigits(digit)}>
              {digit}
            </Button>
          ))}
        </div>
      ) : null}

      {callId && (panel === 'add' || (panel === 'transfer' && answered)) ? (
        <div className={cx('flex flex-wrap items-center gap-2', roomy ? 'mt-4' : 'mt-3')}>
          <PhoneInput
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            type="tel"
            inputMode="tel"
            placeholder="+14165550142"
            aria-label={panel === 'add' ? 'Number to add to the call' : 'Number to transfer to'}
            className={roomy ? 'min-w-44 flex-1 @min-[34rem]/calling:max-w-64' : 'w-44'}
          />
          {panel === 'add' ? (
            <Button size="small" disabled={!number || pending === 'add'} onClick={() => run('add', () => addParticipantAction(organizationId, { callId, toNumber: number }), () => setNumber(''))}>
              Add to call
            </Button>
          ) : (
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
          )}
        </div>
      ) : null}

      {live.length > 0 ? (
        <ul className={cx('flex flex-wrap gap-2 text-sm', roomy ? 'mt-4' : 'mt-2')} aria-label="Who is on this call">
          {live.map((participant) => (
            <li key={participant.id} className="flex items-center gap-2 rounded border border-border px-2 py-1">
              <span>{participant.membershipId !== null && participant.membershipId === known?.ownMembershipId ? 'You' : PARTY_LABEL[participant.party]}</span>
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

      {error || actionError ? <ErrorText role="alert" className="mt-2">{error ?? actionError}</ErrorText> : null}
      {!container && popout?.error && placement === 'dock' ? <ErrorText className="mt-2">{popout.error}</ErrorText> : null}
    </div>
  );
}
