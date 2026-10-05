// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveCallDock } from '@/features/communications/voice/active-call-dock';
import {
  TelephoneDeviceContext,
  type ActiveCall,
  type TelephoneDeviceContextValue,
} from '@/features/communications/voice/telephone-device';
import type { Participant } from '@/lib/domain/reception/conference';

/**
 * The live call bar, over a fake telephone and the real component. What it proves is what the bar
 * *does* with each answer from the server: it never shows a control as having worked when the server
 * said it did not, it hangs the telephone up only when the call is meant to end or the server has
 * agreed the agent may leave, and it says *Leave* and *End* for the two different things. Layout is
 * checked in the browser; whether the carrier really does any of it has only been exercised against a
 * recorder, never a live call.
 */

const actions = vi.hoisted(() => ({
  addParticipantAction: vi.fn(),
  cancelTransferAction: vi.fn(),
  coldTransferAction: vi.fn(),
  completeTransferAction: vi.fn(),
  holdParticipantAction: vi.fn(),
  leaveCallAction: vi.fn(),
  listCallParticipantsAction: vi.fn(),
  removeParticipantAction: vi.fn(),
  warmTransferAction: vi.fn(),
}));
vi.mock('@/app/organizations/[organizationId]/calls/conference-actions', () => actions);

const ORG = 'org-1';
const CALL = 'call-1';
const ME = 'membership-me';

const leg = (over: Partial<Participant> & Pick<Participant, 'id' | 'party'>): Participant => ({
  callId: CALL,
  membershipId: null,
  connectable: true,
  status: 'in_progress',
  onHold: false,
  muted: false,
  joinedAt: '2026-10-05T10:00:00Z',
  leftAt: null,
  ...over,
});

const own = leg({ id: 'leg-me', party: 'agent', membershipId: ME });
const caller = leg({ id: 'leg-caller', party: 'customer' });

const device = {
  hangUp: vi.fn(),
  toggleMute: vi.fn(),
  sendDigits: vi.fn(),
};

function renderDock(participants: Participant[], call: Partial<ActiveCall> = {}) {
  actions.listCallParticipantsAction.mockResolvedValue({ ok: true, data: { participants, ownMembershipId: ME } });
  const value = {
    status: 'ready',
    error: null,
    activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: CALL, contactLabel: 'Ada Lovelace', ...call },
    incoming: null,
    register: vi.fn(),
    unregister: vi.fn(),
    connectToRoom: vi.fn(),
    ...device,
  } as TelephoneDeviceContextValue;
  return render(
    <TelephoneDeviceContext.Provider value={value}>
      <ActiveCallDock organizationId={ORG} />
    </TelephoneDeviceContext.Provider>,
  );
}

beforeEach(() => {
  for (const fn of [...Object.values(actions), ...Object.values(device)]) fn.mockReset();
});
afterEach(cleanup);

const ok = { ok: true, data: null };

describe('the live call bar', () => {
  it('says who is on the call and what state it is in, from the call’s own participants', async () => {
    renderDock([own, caller, leg({ id: 'leg-t', party: 'transfer_target', status: 'ringing' })]);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('In call')).toBeInTheDocument();
    const roster = await screen.findByRole('list', { name: 'Who is on this call' });
    expect(roster).toHaveTextContent('You');
    expect(roster).toHaveTextContent('Caller');
    expect(roster).toHaveTextContent('Transfer');
    expect(roster).toHaveTextContent('Ringing');
  });

  it('sits above the phone navigation bar rather than over it', () => {
    renderDock([own, caller]);
    const bar = screen.getByRole('button', { name: /End call/ }).closest('[class*="fixed"]');
    expect(bar?.className).toMatch(/bottom-\(--mobile-nav-height\)/);
    expect(bar?.className).toMatch(/md:bottom-0/);
  });

  describe('leaving and ending are different things', () => {
    it('ends the call when nobody else from the business is staying, and asks the server for nothing', async () => {
      const user = userEvent.setup();
      renderDock([own, caller]);
      await user.click(await screen.findByRole('button', { name: /End call/ }));
      expect(device.hangUp).toHaveBeenCalledTimes(1);
      expect(actions.leaveCallAction).not.toHaveBeenCalled();
    });

    it('leaves without ending when a colleague is staying, and only after the server agrees', async () => {
      const user = userEvent.setup();
      actions.leaveCallAction.mockResolvedValue(ok);
      renderDock([own, caller, leg({ id: 'leg-colleague', party: 'agent', membershipId: 'membership-other' })]);
      await user.click(await screen.findByRole('button', { name: /Leave call/ }));
      await waitFor(() => expect(device.hangUp).toHaveBeenCalledTimes(1));
      expect(actions.leaveCallAction).toHaveBeenCalledWith(ORG, { callId: CALL });
    });

    it('does not hang up when the server will not let the agent leave, so the customer is not dropped', async () => {
      const user = userEvent.setup();
      actions.leaveCallAction.mockResolvedValue({ ok: false, error: 'Could not leave the call: the carrier is unavailable' });
      renderDock([own, caller, leg({ id: 'leg-colleague', party: 'agent', membershipId: 'membership-other' })]);
      await user.click(await screen.findByRole('button', { name: /Leave call/ }));
      expect(await screen.findByText(/the carrier is unavailable/)).toBeInTheDocument();
      expect(device.hangUp).not.toHaveBeenCalled();
    });

    it('does not count a colleague who is still only ringing as staying', async () => {
      renderDock([own, caller, leg({ id: 'leg-t', party: 'transfer_target', status: 'ringing' })]);
      expect(await screen.findByRole('button', { name: /End call/ })).toBeInTheDocument();
    });
  });

  describe('hold', () => {
    it('asks the server to hold the caller and shows what comes back', async () => {
      const user = userEvent.setup();
      actions.holdParticipantAction.mockResolvedValue(ok);
      renderDock([own, caller]);
      await user.click(await screen.findByRole('button', { name: 'Hold caller' }));
      expect(actions.holdParticipantAction).toHaveBeenCalledWith(ORG, { callId: CALL, participantId: 'leg-caller', hold: true });
    });

    it('shows the refusal and leaves the button as it was when the carrier says no', async () => {
      const user = userEvent.setup();
      actions.holdParticipantAction.mockResolvedValue({ ok: false, error: 'Could not change hold: the carrier is unavailable' });
      renderDock([own, caller]);
      await user.click(await screen.findByRole('button', { name: 'Hold caller' }));
      expect(await screen.findByText(/Could not change hold/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hold caller' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers resume for a caller who is on hold, and not hold for a leg the carrier has not named', async () => {
      renderDock([own, leg({ ...caller, onHold: true })]);
      expect(await screen.findByRole('button', { name: 'Resume caller' })).toHaveAttribute('aria-pressed', 'true');
      cleanup();
      renderDock([own, leg({ ...caller, connectable: false })]);
      expect(await screen.findByRole('button', { name: 'Hold caller' })).toBeDisabled();
    });
  });

  describe('adding and transferring', () => {
    it('adds a person by number, and reports a carrier that would not ring them', async () => {
      const user = userEvent.setup();
      actions.addParticipantAction.mockResolvedValue({ ok: false, error: 'Could not add that participant: the carrier refused' });
      renderDock([own, caller]);
      await user.click(screen.getByRole('button', { name: 'Add' }));
      await user.type(screen.getByLabelText('Number to add to the call'), '+14165550142');
      await user.click(screen.getByRole('button', { name: 'Add to call' }));
      expect(actions.addParticipantAction).toHaveBeenCalledWith(ORG, { callId: CALL, toNumber: '+14165550142' });
      expect(await screen.findByText(/the carrier refused/)).toBeInTheDocument();
    });

    it('hands off and then lets go only when the destination answered', async () => {
      const user = userEvent.setup();
      actions.coldTransferAction.mockResolvedValue({ ok: true, data: { participantId: 'leg-t' } });
      renderDock([own, caller]);
      await user.click(screen.getByRole('button', { name: 'Transfer' }));
      await user.type(screen.getByLabelText('Number to transfer to'), '+14165550143');
      await user.click(screen.getByRole('button', { name: 'Hand off now' }));
      await waitFor(() => expect(device.hangUp).toHaveBeenCalledTimes(1));
      expect(actions.coldTransferAction).toHaveBeenCalledWith(ORG, { callId: CALL, toNumber: '+14165550143' });
    });

    it('stays on the call, with the reason, when the destination never answers', async () => {
      const user = userEvent.setup();
      actions.coldTransferAction.mockResolvedValue({ ok: false, error: 'The person you are transferring to did not answer. You are still on the call.' });
      renderDock([own, caller]);
      await user.click(screen.getByRole('button', { name: 'Transfer' }));
      await user.type(screen.getByLabelText('Number to transfer to'), '+14165550143');
      await user.click(screen.getByRole('button', { name: 'Hand off now' }));
      expect(await screen.findByText(/You are still on the call/)).toBeInTheDocument();
      expect(device.hangUp).not.toHaveBeenCalled();
    });

    it('holds the caller during a warm transfer, and will not complete it until the destination is on the line', async () => {
      const user = userEvent.setup();
      actions.completeTransferAction.mockResolvedValue(ok);
      renderDock([own, leg({ ...caller, onHold: true }), leg({ id: 'leg-t', party: 'transfer_target', status: 'ringing' })]);
      expect(await screen.findByText(/Ringing the person you are transferring to. The caller is on hold/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Complete handoff' })).toBeDisabled();
      cleanup();

      renderDock([own, leg({ ...caller, onHold: true }), leg({ id: 'leg-t', party: 'transfer_target', status: 'in_progress' })]);
      await user.click(await screen.findByRole('button', { name: 'Complete handoff' }));
      await waitFor(() => expect(device.hangUp).toHaveBeenCalledTimes(1));
      expect(actions.completeTransferAction).toHaveBeenCalledWith(ORG, { callId: CALL });
    });

    it('cancels a warm transfer without hanging up', async () => {
      const user = userEvent.setup();
      actions.cancelTransferAction.mockResolvedValue(ok);
      renderDock([own, leg({ ...caller, onHold: true }), leg({ id: 'leg-t', party: 'transfer_target', status: 'in_progress' })]);
      await user.click(await screen.findByRole('button', { name: 'Cancel transfer' }));
      expect(actions.cancelTransferAction).toHaveBeenCalledWith(ORG, { callId: CALL });
      expect(device.hangUp).not.toHaveBeenCalled();
    });

    it('removes a transfer destination or a supervisor, but never offers to remove the caller or oneself', async () => {
      renderDock([own, caller, leg({ id: 'leg-s', party: 'supervisor' })]);
      await screen.findByRole('list', { name: 'Who is on this call' });
      expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(1);
    });
  });

  describe('this browser’s own telephone', () => {
    it('mutes and shows the state the telephone reports, not one it assumed', async () => {
      const user = userEvent.setup();
      renderDock([own, caller], { muted: true });
      const mute = screen.getByRole('button', { name: 'Unmute' });
      expect(mute).toHaveAttribute('aria-pressed', 'true');
      await user.click(mute);
      expect(device.toggleMute).toHaveBeenCalledTimes(1);
    });

    it('sends keypad tones to the telephone', async () => {
      const user = userEvent.setup();
      renderDock([own, caller]);
      await user.click(screen.getByRole('button', { name: 'Keypad' }));
      await user.click(screen.getByRole('button', { name: '5' }));
      await user.click(screen.getByRole('button', { name: '#' }));
      expect(device.sendDigits.mock.calls).toEqual([['5'], ['#']]);
    });
  });
});
