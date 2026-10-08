// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialerPopoutProvider } from '@/features/communications/voice/dialer-popout';
import { ActiveCallDock } from '@/features/communications/voice/active-call-dock';
import { NewCallForm } from '@/features/communications/voice/new-call-form';
import { TelephoneDeviceContext, type TelephoneDeviceContextValue } from '@/features/communications/voice/telephone-device';

vi.mock('@/app/organizations/[organizationId]/calls/conference-actions', () => ({
  mintBrowserTokenAction: vi.fn(),
  dialAction: vi.fn(),
  endCallAction: vi.fn(),
  listCallParticipantsAction: vi.fn().mockResolvedValue({ ok: true, data: { participants: [], ownMembershipId: null } }),
}));

const number = { id: 'number-1', e164: '+14385550194', label: 'Main line' };
const device: TelephoneDeviceContextValue = {
  status: 'ready', error: null, activeCall: null, incoming: null,
  register: vi.fn(), unregister: vi.fn(), connectToRoom: vi.fn(),
  hangUp: vi.fn(), toggleMute: vi.fn(), sendDigits: vi.fn(),
};

function App({ value = device, showForm = true }: { value?: TelephoneDeviceContextValue; showForm?: boolean }) {
  return (
    <TelephoneDeviceContext.Provider value={value}>
      <DialerPopoutProvider organizationId="org-1">
        {showForm ? <NewCallForm organizationId="org-1" numbers={[number]} defaultNumber={number} /> : <h1>Another workspace</h1>}
        <ActiveCallDock organizationId="org-1" />
      </DialerPopoutProvider>
    </TelephoneDeviceContext.Provider>
  );
}

function fakePopup() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const events = new EventTarget();
  const child = { document: doc, closed: false, focus: vi.fn(), close: vi.fn(),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window);
  return { child, doc, events, popup: within(doc.body) };
}

afterEach(() => { cleanup(); document.querySelectorAll('iframe').forEach((frame) => frame.remove()); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('compact dialer pop-out', () => {
  it('keeps the form available and explains when the browser blocks the window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(screen.getByText(/Allow pop-ups for GildOps/)).toBeInTheDocument();
    expect(screen.getByLabelText('Number to call')).toBeInTheDocument();
    expect(device.register).not.toHaveBeenCalled();
  });

  it('carries the draft into the keypad, preserves edits on return, and closes without hanging up', async () => {
    const { child, popup } = fakePopup();
    render(<App />);
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+1514555012' } });
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(popup.getByLabelText('Number to call')).toHaveValue('+1514555012');
    fireEvent.click(popup.getByRole('button', { name: 'Dial 3' }));
    expect(popup.getByLabelText('Number to call')).toHaveValue('+15145550123');
    expect(popup.getByLabelText('Call from')).toHaveValue('');
    fireEvent.click(popup.getByRole('button', { name: 'Return to GildOps' }));
    await waitFor(() => expect(screen.getByLabelText('Number to call')).toHaveValue('+15145550123'));
    expect(child.close).toHaveBeenCalledTimes(1);
    expect(device.hangUp).not.toHaveBeenCalled();
    expect(device.register).not.toHaveBeenCalled();
  });

  it('survives a workspace change and controls the existing live telephone', async () => {
    const { popup } = fakePopup();
    const app = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    const value: TelephoneDeviceContextValue = { ...device,
      activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: null, contactLabel: 'Sarah Mitchell' } };
    app.rerender(<App value={value} showForm={false} />);
    expect(screen.getByText('Another workspace')).toBeInTheDocument();
    expect(popup.getByText('Sarah Mitchell')).toBeInTheDocument();
    expect(popup.queryByLabelText('Number to call')).not.toBeInTheDocument();
    fireEvent.click(popup.getByRole('button', { name: 'Mute' }));
    expect(device.toggleMute).toHaveBeenCalledTimes(1);
    fireEvent.click(popup.getByRole('button', { name: 'Keypad' }));
    fireEvent.click(popup.getByRole('button', { name: '5' }));
    expect(device.sendDigits).toHaveBeenCalledWith('5');
    fireEvent.click(popup.getByRole('button', { name: 'Return to GildOps' }));
    expect(screen.getByText('Sarah Mitchell')).toBeInTheDocument();
    expect(device.hangUp).not.toHaveBeenCalled();
  });

  it('restores controls when the popup is closed using browser chrome', async () => {
    const { events } = fakePopup();
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    act(() => { events.dispatchEvent(new Event('pagehide')); });
    await waitFor(() => expect(screen.getByLabelText('Number to call')).toBeInTheDocument());
    expect(device.hangUp).not.toHaveBeenCalled();
  });

  it('does not enable calling without an outbound number or during another call', () => {
    const app = render(<TelephoneDeviceContext.Provider value={device}><NewCallForm organizationId="org-1" numbers={[]} defaultNumber={null} compact /></TelephoneDeviceContext.Provider>);
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+15145550123' } });
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    app.rerender(<App value={{ ...device, incoming: { accept: vi.fn(), reject: vi.fn() } }} />);
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
  });
});
