import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Agent conversations: source guards, like `workspace-shell.test.ts` — nothing here mounts a
 * component. What is asserted is the shape the reasoning depends on: History and New chat exist
 * in the Chat tab, Activity follows the conversation that is shown, a question's result reaches
 * the rail whichever page asked it, and Platform Agent has no way to answer through a business.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const shared = read('features/agent/agent-shared.tsx');
const tenantRail = read('features/agent/tenant-agent-rail.tsx');
const platformRail = read('features/agent/platform-agent-rail.tsx');
const actions = read('features/agent/actions.ts');
const layout = read('app/organizations/[organizationId]/layout.tsx');
const questions = read('lib/domain/assistant/questions.ts');
const platformQuestions = read('lib/domain/assistant/platform-questions.ts');

describe('the Chat tab has History and New chat', () => {
  it('draws a toolbar, History on the left and New chat on the right, in a Popover', () => {
    const toolbar = shared.slice(shared.indexOf('export function AgentChatToolbar'), shared.indexOf('export function AgentActivityList'));
    expect(shared).toContain("from '@gold/ui/components/popover'");
    expect(toolbar).toContain('<Popover ');
    expect(toolbar).toContain('justify-between');
    expect(toolbar.indexOf('History')).toBeGreaterThan(-1);
    expect(toolbar.indexOf('History')).toBeLessThan(toolbar.indexOf('New chat'));
  });

  it('uses the interaction roles: hover is bg-hover, current is bg-selected, never bg-muted', () => {
    const toolbar = shared.slice(shared.indexOf('export function AgentChatToolbar'), shared.indexOf('export function AgentActivityList'));
    expect(toolbar).toContain('hover:bg-hover');
    expect(toolbar).toContain('bg-selected');
    expect(toolbar).not.toMatch(/bg-muted(?![-\w])/);
    expect(toolbar).toContain("aria-current={current ? 'true' : undefined}");
  });

  it('shows each entry’s title and how recent it is', () => {
    expect(shared).toContain('{conversation.title}');
    expect(shared).toContain('formatRecent(conversation.lastActivityAt)');
  });

  it('keeps the three top-level tabs, and puts the toolbar inside Chat', () => {
    for (const label of ['Chat', 'Context', 'Activity']) {
      expect(shared).toMatch(new RegExp(`<TabsTrigger[^>]*>[^<]*(?:<[^>]+>)?${label}`));
    }
    expect(tenantRail.indexOf('<AgentChatToolbar')).toBeGreaterThan(-1);
    expect(tenantRail.indexOf('<AgentChatToolbar')).toBeLessThan(tenantRail.indexOf('<form'));
  });

  it('New chat is an unsaved state that focuses the composer, and writes nothing', () => {
    const newChat = tenantRail.slice(tenantRail.indexOf('function newChat'), tenantRail.indexOf('const chat ='));
    expect(newChat).toContain("setView({ kind: 'new' })");
    expect(newChat).toContain('composer.current?.focus()');
    // Nothing is created until the first question: no action call in the handler.
    expect(newChat).not.toMatch(/Action\(|createAgentConversation/);
  });

  it('selecting a conversation loads its transcript on demand', () => {
    expect(tenantRail).toContain('openConversationAction(organizationId, conversationId)');
  });

  it('keeps conversation ids out of every URL', () => {
    expect(code(tenantRail)).not.toMatch(/router\.(push|replace)|searchParams|useSearchParams/);
    expect(code(actions)).not.toMatch(/redirect\(/);
  });
});

describe('Activity and Chat follow the selected conversation', () => {
  it('Activity is given the shown conversation’s runs, not every run', () => {
    expect(tenantRail).toContain('<AgentActivityList runs={shown?.runs ?? []} />');
    expect(tenantRail).toContain('runs={shown.runs}');
  });

  it('Context stays the live workspace the Agent sees', () => {
    expect(tenantRail).toContain("{ title: 'Current workspace', description: area?.label ?? 'Unknown' }");
  });

  it('the composer says which conversation it is asking into', () => {
    expect(tenantRail).toContain('name="conversationId"');
  });
});

describe('the shell loads a bounded list and one transcript', () => {
  it('reads summaries and only the latest transcript, never every run', () => {
    expect(layout).toContain('listAgentConversationSummaries(db, { organizationId })');
    expect(layout.match(/listAgentConversationRuns\(/g)).toHaveLength(1);
    expect(layout).not.toContain('listAgentRuns');
    expect(questions).not.toMatch(/export async function listAgentRuns/);
    expect(questions).toMatch(/CONVERSATION_LIST_LIMIT = \d+/);
    expect(questions).toMatch(/CONVERSATION_RUN_LIMIT = \d+/);
  });

  it('lists History most recently active first', () => {
    expect(questions).toContain(".order('last_activity_at', { ascending: false })");
  });

  it('never filters by author in TypeScript — the policy is the boundary', () => {
    expect(code(questions)).not.toContain(".eq('created_by'");
  });
});

describe('a question’s result reaches the rail from any page', () => {
  it('returns the conversation it wrote, so no route has to be the one that revalidates', () => {
    expect(actions).toContain('runs: await listAgentConversationRuns(');
    expect(tenantRail).toContain("setView({ kind: 'opened'");
  });

  it('still refreshes the whole organization layout, never one page', () => {
    expect(actions).toContain("revalidatePath(`/organizations/${organizationId}`, 'layout')");
    expect(code(actions)).not.toMatch(/\/ask\b/);
  });

  it('keeps pending and error behaviour on the composer', () => {
    expect(tenantRail).toContain("{asking ? 'Asking…' : 'Ask'}");
    expect(tenantRail).toContain('disabled={!mayAsk || asking}');
    expect(tenantRail).toContain('{askError ? <ErrorText role="alert">{askError}</ErrorText> : null}');
  });
});

describe('Platform Agent has no organization-backed shortcut', () => {
  it('reads no conversation, action or tenant answering code', () => {
    const source = code(platformRail);
    expect(source).not.toMatch(/askAction|openConversationAction|decideAction/);
    expect(source).not.toMatch(/AgentChatToolbar|conversationId|listAgentConversation/);
    expect(source).not.toContain('@/lib/domain/assistant/questions');
    expect(source).not.toContain('organizationId:');
  });

  it('stays honestly unavailable until a platform-scoped endpoint exists', () => {
    const source = code(platformQuestions);
    expect(source).toMatch(/return false;/);
    expect(source).not.toMatch(/import /);
    expect(source).not.toContain('askQuestion');
    expect(source).not.toContain('agent_conversations');
    expect(code(platformRail)).toContain('<AgentUnavailable configureHref="/platform/providers" />');
  });

  it('the platform layout is not handed a tenant’s conversations', () => {
    const platformLayout = `${WEB}/app/(platform)/platform/layout.tsx`;
    expect(existsSync(platformLayout)).toBe(true);
    const source = readFileSync(platformLayout, 'utf8');
    expect(source).not.toMatch(/listAgentConversation|TenantAgentRail/);
  });
});
