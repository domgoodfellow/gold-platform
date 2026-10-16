// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { AgentTrigger, WorkspaceRailProvider, WorkspaceRightRail } from '@/components/panels/workspace-right-rail';
import { TenantAgentRail } from '@/features/agent/tenant-agent-rail';
import type { AgentBootstrapState } from '@/features/agent/actions';

const bootstrap = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
const openConversation = vi.hoisted(() => vi.fn());
vi.mock('@/features/agent/actions', () => ({
  loadAgentBootstrapAction: bootstrap, askAction: vi.fn(), decideAction: vi.fn(),
  openConversationAction: openConversation, removeAttachmentAction: vi.fn(), uploadAttachmentAction: upload,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/organizations/org/crm' }));

const success: AgentBootstrapState = {
  error: null, canAnswer: true, conversations: [], initialConversation: null, identity: 'Built-in Operator Copilot',
};
function Harness({ organizationId = 'org' }: { organizationId?: string }) {
  return <TooltipProvider><WorkspaceRailProvider>
    <AgentTrigger />
    <WorkspaceRightRail main={<div>The page</div>} />
    <TenantAgentRail organizationId={organizationId} organizationName="Business" timezone="America/Toronto" mayAsk canManageAgent={false} />
  </WorkspaceRailProvider></TooltipProvider>;
}
beforeEach(() => {
  bootstrap.mockReset();
  upload.mockReset();
  openConversation.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Agent bootstrap recovery', () => {
  it.each(['rejected request', 'database error'])('shows a visible error and successful Retry after a %s', async (kind) => {
    const user = userEvent.setup();
    if (kind === 'rejected request') bootstrap.mockRejectedValueOnce(new Error('Failed to fetch'));
    else bootstrap.mockResolvedValueOnce({ ...success, error: 'Could not load your Agent conversation history. Try again.', errorCode: 'database' });
    let complete!: (result: AgentBootstrapState) => void;
    bootstrap.mockReturnValueOnce(new Promise<AgentBootstrapState>((resolve) => { complete = resolve; }));
    render(<Harness />);
    expect(bootstrap).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(kind === 'database error' ? 'conversation history' : 'Could not connect');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    await act(async () => complete(success));
    expect(await screen.findByRole('textbox', { name: 'Message to the Agent' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(screen.queryByText(/signed-in operator scope/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(bootstrap).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('retains a composer draft while retrying an identity warning', async () => {
    const user = userEvent.setup();
    const conversation = { id: 'previous-chat', title: 'Previous conversation', createdAt: '2026-10-09T12:00:00Z', lastActivityAt: '2026-10-09T12:00:00Z' };
    const history = { ...success, conversations: [conversation], initialConversation: { id: conversation.id, runs: [] } };
    bootstrap.mockResolvedValueOnce({ ...history, identityError: 'Agent identity could not be loaded. Using Built-in Operator Copilot.' });
    let complete!: (result: AgentBootstrapState) => void;
    bootstrap.mockReturnValueOnce(new Promise<AgentBootstrapState>((resolve) => { complete = resolve; }));
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await user.type(screen.getByRole('textbox'), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('Keep this draft');
    await act(async () => complete(history));
    expect(screen.getByRole('textbox')).toHaveValue('Keep this draft');
    expect(screen.queryByText('Previous conversation')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores a late bootstrap response from the previous organization', async () => {
    const user = userEvent.setup();
    let complete!: (result: AgentBootstrapState) => void;
    bootstrap.mockReturnValueOnce(new Promise<AgentBootstrapState>((resolve) => { complete = resolve; }));
    bootstrap.mockResolvedValueOnce({ ...success, conversations: [{ id: 'other-chat', title: 'Current organization conversation', createdAt: '2026-10-09T12:00:00Z', lastActivityAt: '2026-10-09T12:00:00Z' }], initialConversation: { id: 'other-chat', runs: [] } });
    const { rerender } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    rerender(<Harness organizationId="other-org" />);
    await screen.findByText('Current organization conversation');
    await act(async () => complete({ ...success, conversations: [{ id: 'previous-chat', title: 'Previous organization conversation', createdAt: '2026-10-09T12:00:00Z', lastActivityAt: '2026-10-09T12:00:00Z' }], initialConversation: { id: 'previous-chat', runs: [] } }));
    expect(screen.queryByText('Previous organization conversation')).not.toBeInTheDocument();
    expect(bootstrap).toHaveBeenLastCalledWith('other-org');
  });

  it('keeps uploading and uploaded attachments and selected History across close/reopen', async () => {
    const conversation = { id: 'saved-chat', title: 'Saved conversation', createdAt: '2026-10-09T12:00:00Z', lastActivityAt: '2026-10-09T12:00:00Z' };
    bootstrap.mockResolvedValueOnce({ ...success, conversations: [conversation] });
    openConversation.mockResolvedValueOnce({ error: null, conversationId: conversation.id, runs: [] });
    let complete!: (result: { error: null; attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number } }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent' }));
    await screen.findByRole('textbox');
    await userEvent.type(screen.getByRole('textbox'), 'Draft with attachment');
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(screen.getByRole('button', { name: 'Cancel notes.txt' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agent' }));
    await act(async () => complete({ error: null, attachment: { id: 'document-id', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5 } }));
    await userEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('textbox')).toHaveValue('Draft with attachment');
    expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await userEvent.click(screen.getByRole('button', { name: /Saved conversation/ }));
    expect(screen.getByRole('heading', { name: 'Saved conversation' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('heading', { name: 'Saved conversation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeInTheDocument();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(openConversation).toHaveBeenCalledWith('org', 'saved-chat');
  });
});
