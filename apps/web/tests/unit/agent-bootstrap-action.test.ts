import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notFound, redirect } from 'next/navigation';
import { DomainError } from '@/lib/domain/errors';
import { loadAgentBootstrapAction } from '@/features/agent/actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), summaries: vi.fn(), runs: vi.fn(), readiness: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/db/server', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/route/organization', () => ({ requireOrganization: mocks.access }));
vi.mock('@/lib/domain/assistant/questions', () => ({
  listAgentConversationSummaries: mocks.summaries, listAgentConversationRuns: mocks.runs,
  canAnswerQuestions: mocks.readiness, askQuestion: vi.fn(), decideOnAction: vi.fn(),
}));
vi.mock('@/lib/domain/assistant/attachments', () => ({ removeAgentAttachment: vi.fn(), uploadAgentAttachment: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { capabilities: ['assistant.ask'] } });
  mocks.summaries.mockResolvedValue([{ id: 'conversation', title: 'Previous chat' }]);
  mocks.runs.mockResolvedValue([{ id: 'run', question: 'Previous question' }]);
  mocks.readiness.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('Agent bootstrap action', () => {
  it.each([
    ['authentication', new DomainError('internal', 'auth.required')],
    ['permission', new DomainError('internal', 'organization.forbidden')],
    ['transient', new Error('network unavailable')],
  ])('returns a controlled %s access failure', async (code, error) => {
    mocks.access.mockRejectedValue(error);
    const result = await loadAgentBootstrapAction('org');
    expect(result.errorCode).toBe(code);
    expect(result.error).not.toContain('internal');
    expect(result.canAnswer).toBe(false);
    expect(mocks.summaries).not.toHaveBeenCalled();
  });

  it('preserves the Next.js sign-in redirect', async () => {
    mocks.access.mockImplementation(() => redirect('/login'));
    await expect(loadAgentBootstrapAction('org')).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  });

  it('preserves the Next.js membership refusal', async () => {
    mocks.access.mockImplementation(() => notFound());
    await expect(loadAgentBootstrapAction('org')).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    expect(mocks.summaries).not.toHaveBeenCalled();
  });

  it('distinguishes a rejected network read from a returned database failure', async () => {
    mocks.summaries.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await loadAgentBootstrapAction('org')).errorCode).toBe('transient');
  });

  it.each(['summaries', 'runs'] as const)('returns a database error when %s fail and succeeds on retry', async (read) => {
    mocks[read].mockRejectedValueOnce(new DomainError('sensitive database detail', 'assistant.list_failed'));
    const result = await loadAgentBootstrapAction('org');
    expect(result.errorCode).toBe('database');
    expect(result.error).toContain('conversation history');
    expect(result.error).not.toContain('sensitive');
    expect(result.initialConversation).toBeNull();
    expect((await loadAgentBootstrapAction('org')).initialConversation?.id).toBe('conversation');
  });

  it.each(['returned', 'rejected'])('retains history and Copilot when identity lookup has a %s failure', async (kind) => {
    if (kind === 'returned') mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private detail' } });
    else mocks.rpc.mockRejectedValue(new Error('private detail'));
    const result = await loadAgentBootstrapAction('org');
    expect(result.error).toBeNull();
    expect(result.identity).toBe('Built-in Operator Copilot');
    expect(result.identityError).toContain('identity could not be loaded');
    expect(result.initialConversation?.runs).toHaveLength(1);
    expect(result.canAnswer).toBe(true);
  });

  it('uses a configured identity, and a normal fallback when none is configured', async () => {
    expect((await loadAgentBootstrapAction('org')).identityError).toBeUndefined();
    mocks.rpc.mockResolvedValue({ data: { name: 'Operations Agent' }, error: null });
    expect((await loadAgentBootstrapAction('org')).identity).toBe('Operations Agent');
  });

  it('skips identity lookup without asking permission while retaining history', async () => {
    mocks.access.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { capabilities: [] } });
    expect((await loadAgentBootstrapAction('org')).initialConversation?.id).toBe('conversation');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
