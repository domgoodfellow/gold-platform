// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelephoneDeviceProvider, useTelephoneDevice, type TelephoneDeviceContextValue } from '@/features/communications/voice/telephone-device';

/**
 * The one telephone session's own account of a call's time, over a fake carrier device. What it
 * proves is the session's bookkeeping: ringing and talking are kept as two spans, a placed call is
 * not "answered" because this browser joined its room, and the ended call carries both figures and
 * the number it was placed from. It proves nothing about the carrier.
 */

type Listener = (...args: unknown[]) => void;
const { Emitter, carrier } = vi.hoisted(() => ({
  Emitter: class {
    private listeners = new Map<string, Listener[]>();
    on(event: string, listener: Listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); return this; }
    emit(event: string, ...args: unknown[]) { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
  },
  carrier: { device: null as unknown, placed: null as unknown, Call: null as unknown },
}));
class FakeCall extends Emitter {
  muted = false;
  accept = vi.fn(() => this.emit('accept'));
  reject = vi.fn();
  disconnect = vi.fn(() => this.emit('disconnect'));
  mute = vi.fn();
  isMuted = () => this.muted;
  sendDigits = vi.fn();
}
carrier.Call = FakeCall;
vi.mock('@twilio/voice-sdk', () => ({
  Device: class extends Emitter {
    constructor() { super(); carrier.device = this; }
    register = async () => { this.emit('registered'); };
    connect = async () => { const call = new (carrier.Call as typeof FakeCall)(); carrier.placed = call; return call; };
    updateToken = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('@/app/organizations/[organizationId]/calls/conference-actions', () => ({
  mintBrowserTokenAction: vi.fn().mockResolvedValue({ ok: true, data: { token: 'token' } }),
}));

let session: TelephoneDeviceContextValue;
/** Hands the session's current value to the test after each render. */
function Probe() {
  const value = useTelephoneDevice();
  useEffect(() => { session = value; });
  return null;
}
const start = () => render(<TelephoneDeviceProvider organizationId="org"><Probe /></TelephoneDeviceProvider>);
const placed = () => carrier.placed as FakeCall;
const device = () => carrier.device as InstanceType<typeof Emitter>;
const T0 = Date.parse('2026-11-15T15:00:00Z');
const at = (seconds: number) => vi.setSystemTime(T0 + seconds * 1000);

beforeEach(() => { vi.useFakeTimers(); at(0); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function place(meta: { fromNumber?: string } = {}) {
  start();
  await act(async () => { await session.connectToRoom('room', { callId: 'call', contactLabel: 'Ada', customerId: 'ada', ...meta }); });
}

describe('a placed call', () => {
  it('is ringing until the call’s own record says the other person answered; joining the room is not an answer', async () => {
    await place({ fromNumber: '+14165550100' });
    expect(session.activeCall).toMatchObject({ status: 'ringing', startedAt: T0, answeredAt: null, fromNumber: '+14165550100', customerId: 'ada' });
    at(2);
    act(() => placed().emit('accept'));
    // This telephone is connected to the room; nobody has answered, and ringing is still timed from the start.
    expect(session.activeCall).toMatchObject({ status: 'in_progress', startedAt: T0, answeredAt: null });
    at(14);
    act(() => session.noteAnswered?.(T0 + 12_000));
    expect(session.activeCall).toMatchObject({ startedAt: T0, answeredAt: T0 + 12_000 });
  });

  it('ends with ringing and talking as two figures, and the number it was placed from', async () => {
    await place({ fromNumber: '+14165550100' });
    at(2); act(() => placed().emit('accept'));
    at(12); act(() => session.noteAnswered?.(T0 + 12_000));
    at(137); act(() => placed().emit('disconnect'));
    expect(session.activeCall).toBeNull();
    expect(session.ended).toEqual({ callId: 'call', contactLabel: 'Ada', customerId: 'ada', direction: 'outgoing', ringSeconds: 12, durationSeconds: 125, fromNumber: '+14165550100' });
  });

  it('has no talk time when nobody answered, however long this telephone sat in the room', async () => {
    await place();
    at(1); act(() => placed().emit('accept'));
    at(25); act(() => placed().emit('disconnect'));
    expect(session.ended).toMatchObject({ ringSeconds: 25, durationSeconds: null });
  });

  it('keeps the first report of the answer, and keeps a reported instant inside the call’s own span', async () => {
    await place();
    at(10);
    // A server clock running ahead of this one cannot put the answer in the future.
    act(() => session.noteAnswered?.(T0 + 60_000));
    expect(session.activeCall?.answeredAt).toBe(T0 + 10_000);
    at(30);
    act(() => session.noteAnswered?.(T0 + 20_000));
    expect(session.activeCall?.answeredAt).toBe(T0 + 10_000);
  });

  it('does not let an answer earlier than the call began reach back before it', async () => {
    await place();
    at(5);
    act(() => session.noteAnswered?.(T0 - 30_000));
    expect(session.activeCall?.answeredAt).toBe(T0);
  });

  it('takes the moment it is told as the answer when no instant is known', async () => {
    await place();
    at(7);
    act(() => session.noteAnswered?.());
    expect(session.activeCall?.answeredAt).toBe(T0 + 7_000);
  });
});

describe('an incoming call', () => {
  it('is answered when this person accepts it, and rings until then', async () => {
    start();
    await act(async () => { await session.register(); });
    const call = new FakeCall();
    at(3);
    act(() => device().emit('incoming', call));
    expect(session.activeCall).toMatchObject({ status: 'ringing', direction: 'incoming', startedAt: T0 + 3_000, answeredAt: null, callId: null });
    at(9);
    act(() => session.incoming?.accept());
    expect(session.activeCall).toMatchObject({ status: 'in_progress', startedAt: T0 + 3_000, answeredAt: T0 + 9_000 });
    at(69);
    act(() => call.emit('disconnect'));
    expect(session.ended).toMatchObject({ direction: 'incoming', ringSeconds: 6, durationSeconds: 60 });
  });
});

describe('a new call', () => {
  it('clears the call that ended before it', async () => {
    await place();
    at(4); act(() => placed().emit('disconnect'));
    expect(session.ended).not.toBeNull();
    await act(async () => { await session.connectToRoom('room-2', { callId: 'call-2', contactLabel: 'Bob' }); });
    expect(session.ended).toBeNull();
    expect(session.activeCall).toMatchObject({ callId: 'call-2', answeredAt: null });
  });
});
