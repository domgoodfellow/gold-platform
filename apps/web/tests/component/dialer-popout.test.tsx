// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialerPopoutProvider } from '@/features/communications/voice/dialer-popout';
import { ActiveCallDock } from '@/features/communications/voice/active-call-dock';
import { DialerWorkspace } from '@/features/communications/voice/dialer-workspace';
import { NewCallForm } from '@/features/communications/voice/new-call-form';
import { DialerTrigger } from '@/features/communications/voice/dialer-trigger';
import { TelephoneDeviceContext, type TelephoneDeviceContextValue } from '@/features/communications/voice/telephone-device';
import type { OutboundLine } from '@/lib/application/communications/calling-options';
import '../support/select-field';

/**
 * The pop-out window over the real provider, the real Dialer page and the real live-call controls,
 * with a fake telephone and a fake browser window. What it proves is that the window is another
 * presentation of the same session: the draft travels both ways, the one telephone is never
 * registered again or hung up by opening, closing or navigating, and both windows use one wording.
 */

vi.mock('@/app/organizations/[organizationId]/calls/conference-actions', () => ({
  mintBrowserTokenAction: vi.fn(),
  dialAction: vi.fn(),
  endCallAction: vi.fn(),
  listCallParticipantsAction: vi.fn().mockResolvedValue({ ok: true, data: { participants: [], ownMembershipId: null } }),
}));
vi.mock('@/app/organizations/[organizationId]/calls/actions', () => ({ matchDialerContact: vi.fn().mockResolvedValue({ state: 'none' }), endedCallRecord: vi.fn().mockResolvedValue(null), callContactContext: vi.fn().mockResolvedValue(null) }));
vi.mock('@/app/organizations/[organizationId]/calls/call-list-actions', () => ({ removeFromCallListAction: vi.fn(), loadCallListAction: vi.fn(), nextCallListEntryAction: vi.fn(), callListEntryAction: vi.fn(), completeCallTaskAction: vi.fn() }));
vi.mock('@/features/communications/voice/add-to-call-list', () => ({ AddToCallList: () => null }));
vi.mock('@/features/communications/voice/wrap-up-sheet', () => ({ WrapUpCallSheet: () => null }));
vi.mock('next/navigation', async (original) => ({ ...(await original<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));

const number: OutboundLine = { id: 'number-1', e164: '+14385550194', label: 'Main line', source: 'member_default', group: 'assigned' };
const loadOptions = vi.hoisted(() => vi.fn());
vi.mock('@/app/organizations/[organizationId]/calls/dialer-actions', () => ({ loadDialerAction: loadOptions }));
const device: TelephoneDeviceContextValue = {
  status: 'ready', error: null, activeCall: null, incoming: null,
  register: vi.fn(), unregister: vi.fn(), connectToRoom: vi.fn(),
  hangUp: vi.fn(), toggleMute: vi.fn(), sendDigits: vi.fn(),
};
// A member who may type in any number, as these cases dial numbers by hand.
const options = { numbers: [number], defaultNumber: number, unavailableReason: null, blocker: null, manualDialing: true };
const noCalls = { all: 0, mine: 0, due: 0, overdue: 0, upcoming: 0, callbacks: 0 };

/** The organization layout's providers around the header's phone button, a page and the dock. */
function App({ value = device, showDialer = true }: { value?: TelephoneDeviceContextValue; showDialer?: boolean }) {
  return (
    <TelephoneDeviceContext.Provider value={value}>
      <DialerPopoutProvider organizationId="org-1">
        <DialerTrigger />
        {showDialer ? <DialerWorkspace organizationId="org-1" timezone="America/Toronto" queue={[]} queueTotal={0} queueCounts={noCalls} queueAvailable options={options} /> : <h1>Another workspace</h1>}
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
  it('opens from the global phone button and loads current calling options without registering a telephone', async () => {
    const { popup } = fakePopup();
    loadOptions.mockResolvedValue(options);
    render(<App showDialer={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open dialer' }));
    await waitFor(() => expect(popup.getByLabelText('Number to call')).toBeVisible());
    expect(loadOptions).toHaveBeenCalledWith('org-1');
    expect(popup.getByLabelText('Call from')).toHaveTextContent('Main line');
    expect(device.register).not.toHaveBeenCalled();
  });

  it('shows unavailable calling from the global phone button without enabling a call', async () => {
    const { popup } = fakePopup();
    loadOptions.mockResolvedValue({ numbers: [], defaultNumber: null, unavailableReason: 'Your role cannot place calls.', blocker: { kind: 'restricted', code: 'no-permission', reason: 'Your role cannot place calls.', setup: null }, setup: null });
    render(<App showDialer={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open dialer' }));
    await waitFor(() => expect(popup.getByText('Your role cannot place calls.')).toBeVisible());
    expect(popup.getByRole('button', { name: 'Call' })).toBeDisabled();
    expect(popup.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription('Your role cannot place calls.');
    expect(device.register).not.toHaveBeenCalled();
  });

  it('shows the same Automatic number and reason in the window as on the page', async () => {
    const { popup } = fakePopup();
    const shared: OutboundLine = { id: 'pool', e164: '+14385550111', label: 'Sales line', source: 'shared', group: 'shared' };
    render(
      <TelephoneDeviceContext.Provider value={device}>
        <DialerPopoutProvider organizationId="org-1">
          <DialerWorkspace organizationId="org-1" timezone="America/Toronto" queue={[]} queueTotal={0} queueCounts={noCalls} queueAvailable options={{ ...options, numbers: [number, shared] }} />
        </DialerPopoutProvider>
      </TelephoneDeviceContext.Provider>,
    );
    const onPage = 'Automatic · Main line · (438)555-0194';
    expect(screen.getByLabelText('Call from')).toHaveTextContent(onPage);
    expect(screen.getByText('Your default number')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(popup.getByLabelText('Call from')).toHaveTextContent(onPage);
    expect(popup.getAllByText('Your default number')).toHaveLength(1);
    // The page hands the form over, so the number is stated in one window at a time.
    expect(screen.queryByLabelText('Call from')).not.toBeInTheDocument();
  });

  it('gives a blocker loaded for the window its kind and the link the viewer may open', async () => {
    const { popup } = fakePopup();
    const reason = 'No outbound number is assigned to you or shared in this business.';
    loadOptions.mockResolvedValue({ numbers: [], defaultNumber: null, unavailableReason: reason, blocker: { kind: 'not-configured', code: 'no-eligible-number', reason, setup: 'phone-numbers' }, setup: { href: '/organizations/org-1/comms/configuration/numbers', label: 'Numbers & assignments' } });
    render(<App showDialer={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open dialer' }));
    const status = await waitFor(() => popup.getByRole('status'));
    expect(status).toHaveAttribute('data-state', 'not-configured');
    expect(within(status).getByRole('link', { name: 'Numbers & assignments' })).toHaveAttribute('href', '/organizations/org-1/comms/configuration/numbers');
    // The main window holds the telephone, so the link opens beside it, not in the dialer window.
    expect(within(status).getByRole('link', { name: 'Numbers & assignments' })).toHaveAttribute('target', '_blank');
    expect(popup.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription(reason);
  });

  it('offers no link in the window to a viewer who has no door to the fix', async () => {
    const { popup } = fakePopup();
    const reason = 'No outbound number is assigned to you or shared in this business.';
    loadOptions.mockResolvedValue({ numbers: [], defaultNumber: null, unavailableReason: reason, blocker: { kind: 'not-configured', code: 'no-eligible-number', reason, setup: 'phone-numbers' }, setup: null });
    render(<App showDialer={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open dialer' }));
    const status = await waitFor(() => popup.getByRole('status'));
    expect(status).toHaveTextContent(reason);
    expect(within(status).queryByRole('link')).not.toBeInTheDocument();
  });

  it('carries the Dialer’s own blocker into the window it opens', async () => {
    const { popup } = fakePopup();
    const blocked = { numbers: [], defaultNumber: null, unavailableReason: 'Calling is temporarily unavailable.', blocker: { kind: 'unavailable' as const, code: 'service-unavailable' as const, reason: 'Calling is temporarily unavailable.', setup: null } };
    render(
      <TelephoneDeviceContext.Provider value={device}>
        <DialerPopoutProvider organizationId="org-1">
          <DialerWorkspace organizationId="org-1" timezone="America/Toronto" queue={[]} queueTotal={0} queueCounts={noCalls} queueAvailable options={blocked} />
        </DialerPopoutProvider>
      </TelephoneDeviceContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(popup.getAllByText('Calling is temporarily unavailable.')).toHaveLength(1);
    expect(popup.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription('Calling is temporarily unavailable.');
  });

  it('keeps the form available and explains when the browser blocks the window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    for (const alert of screen.getAllByRole('alert')) expect(alert).toHaveTextContent(/Allow pop-ups for GildOps/);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Number to call')).toBeInTheDocument();
    expect(device.register).not.toHaveBeenCalled();
  });

  it('carries the draft into the keypad, preserves edits on return, and closes without hanging up', async () => {
    const { child, popup } = fakePopup();
    render(<App />);
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+1514555012' } });
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(popup.getByLabelText('Number to call')).toHaveValue('+1514555012');
    // The Dialer page hands the form over; it is not drawn twice.
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    expect(screen.getByText('The dialer is open in a separate window.')).toBeVisible();
    fireEvent.click(popup.getByRole('button', { name: 'Dial 3' }));
    expect(popup.getByLabelText('Number to call')).toHaveValue('+15145550123');
    expect(popup.getByLabelText('Call from')).toHaveValue('');
    fireEvent.click(popup.getByRole('button', { name: 'Return to GildOps' }));
    await waitFor(() => expect(screen.getByLabelText('Number to call')).toHaveValue('(514)555-0123'));
    expect(child.close).toHaveBeenCalledTimes(1);
    expect(device.hangUp).not.toHaveBeenCalled();
    expect(device.register).not.toHaveBeenCalled();
  });

  it('words this browser’s telephone the same way in the window and on the Dialer page', async () => {
    const { popup } = fakePopup();
    const app = render(<App value={{ ...device, status: 'offline' }} />);
    const onPage = screen.getByRole('region', { name: 'Calling readiness' });
    expect(onPage).toHaveTextContent('Browser phone Connects when needed');
    expect(within(onPage).getByRole('button', { name: 'Receive calls here' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(popup.getByText('Connects when needed')).toBeVisible();
    expect(popup.getByRole('button', { name: 'Receive calls here' })).toBeEnabled();
    app.rerender(<App value={{ ...device, status: 'ready' }} />);
    expect(popup.getByText('Connected')).toBeVisible();
    expect(popup.getByRole('button', { name: 'Stop receiving calls' })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: 'Calling readiness' })).getByText('Connected')).toBeVisible();
  });

  it('survives a workspace change and controls the existing live telephone', async () => {
    const { popup } = fakePopup();
    const app = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    const value: TelephoneDeviceContextValue = { ...device,
      activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: null, contactLabel: 'Sarah Mitchell' } };
    app.rerender(<App value={value} showDialer={false} />);
    expect(screen.getByText('Another workspace')).toBeInTheDocument();
    expect(popup.getByText('Sarah Mitchell')).toBeInTheDocument();
    expect(popup.queryByLabelText('Number to call')).not.toBeInTheDocument();
    // The call is drawn once: in the window, not also in the dock behind it.
    expect(screen.queryByText('Sarah Mitchell')).not.toBeInTheDocument();
    fireEvent.click(popup.getByRole('button', { name: 'Mute' }));
    expect(device.toggleMute).toHaveBeenCalledTimes(1);
    fireEvent.click(popup.getByRole('button', { name: 'Keypad' }));
    fireEvent.click(popup.getByRole('button', { name: '5' }));
    expect(device.sendDigits).toHaveBeenCalledWith('5');
    fireEvent.click(popup.getByRole('button', { name: 'Return to GildOps' }));
    expect(screen.getByText('Sarah Mitchell')).toBeInTheDocument();
    expect(device.hangUp).not.toHaveBeenCalled();
  });

  it('keeps a live call when the Dialer page changes presentation or hands it to the window and back', async () => {
    fakePopup();
    const value: TelephoneDeviceContextValue = { ...device,
      activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: null, contactLabel: 'Sarah Mitchell' } };
    render(<App value={value} />);
    const controls = () => screen.getByRole('group', { name: 'Call controls' });
    expect(controls()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(controls()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(screen.getByText('This call is in the separate dialer window.')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Return to GildOps' })[0]);
    await waitFor(() => expect(controls()).toBeInTheDocument());
    expect(device.hangUp).not.toHaveBeenCalled();
    expect(device.unregister).not.toHaveBeenCalled();
    expect(device.register).not.toHaveBeenCalled();
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
    const form = (value: TelephoneDeviceContextValue, numbers = [number]) => <TelephoneDeviceContext.Provider value={value}><NewCallForm organizationId="org-1" numbers={numbers} defaultNumber={numbers[0] ?? null} toNumber="+15145550123" presentation="window" /></TelephoneDeviceContext.Provider>;
    const app = render(form(device, []));
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription('No outbound line is available.');
    app.rerender(form(device));
    expect(screen.getByRole('button', { name: 'Call' })).toBeEnabled();
    app.rerender(form({ ...device, incoming: { accept: vi.fn(), reject: vi.fn() } }));
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription('Finish the current call before starting another.');
  });
});
