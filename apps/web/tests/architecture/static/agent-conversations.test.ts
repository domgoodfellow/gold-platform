import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatsFor } from '@/lib/domain/files/formats';

/**
 * The Agent panel is a conversation: source guards, like `workspace-shell.test.ts` — nothing here
 * mounts a component. What is asserted is the shape the reasoning depends on: the grammar is
 * Agent header → conversation header → transcript → composer, with no tabs; the transcript is the
 * shared Message Scroller and the only thing that scrolls; Context and Configure are composer
 * popovers that show only what exists; a question's result reaches the rail whichever page asked
 * it; and Platform Agent has no way to answer through a business.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const UI = fileURLToPath(new URL('../../../../../packages/ui', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const between = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to));

const shared = read('features/agent/agent-shared.tsx');
const tenantRail = read('features/agent/tenant-agent-rail.tsx');
const platformRail = read('features/agent/platform-agent-rail.tsx');
const actions = read('features/agent/actions.ts');
const layout = read('features/shell/organization-shell.tsx');
const questions = read('lib/domain/assistant/questions.ts');
const platformQuestions = read('lib/domain/assistant/platform-questions.ts');
const rightRail = read('components/panels/workspace-right-rail.tsx');

describe('the Agent grammar is header → conversation header → transcript → composer', () => {
  it('has no Chat / Context / Activity tabs and no presentation abstraction for them', () => {
    for (const source of [shared, tenantRail, platformRail]) {
      expect(code(source)).not.toMatch(/AgentTabs|TabsTrigger|TabsList|components\/tabs|AgentActivityList|AgentContextList/);
    }
  });

  it('composes the tenant panel in that order', () => {
    const panel = tenantRail.slice(tenantRail.indexOf('return (\n    <AgentPanelFrame>'));
    const order = ['<AgentConversationHeader', '<AgentTranscript', '<AgentComposer'].map((tag) => panel.indexOf(tag));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('leaves the rail’s geometry alone: same minimum width, and the panel is not a scroll container', () => {
    expect(rightRail).toContain('const AGENT_MIN_WIDTH = 320;');
    const panel = between(rightRail, 'function AgentPanel()', '/** Rendered by `AppShell`');
    expect(panel).toContain('overflow-hidden');
    expect(panel).not.toContain('overflow-y-auto');
    expect(panel).toContain('<h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Agent</h2>');
    expect(panel).toContain('aria-label="Close Agent"');
  });
});

describe('the conversation header', () => {
  const header = between(shared, 'export function AgentConversationHeader', 'export function AgentUnavailable');

  it('shows the title, with History and New chat as its actions, in that order', () => {
    expect(header).toContain('{title}');
    expect(header.indexOf('History')).toBeGreaterThan(header.indexOf('{title}'));
    expect(header.indexOf('New chat')).toBeGreaterThan(header.indexOf('History'));
  });

  it('History is a Popover of the bounded list, most recent first — not a page', () => {
    expect(shared).toContain("from '@gold/ui/components/popover'");
    expect(header).toContain('<Popover ');
    expect(code(tenantRail + header)).not.toMatch(/router\.(push|replace)|href=.*history/i);
    expect(questions).toContain(".order('last_activity_at', { ascending: false })");
    expect(questions).toMatch(/CONVERSATION_LIST_LIMIT = \d+/);
  });

  it('uses the interaction roles: hover is bg-hover, current is bg-selected, never bg-muted', () => {
    expect(header).toContain('hover:bg-hover');
    expect(header).toContain('bg-selected');
    expect(header).not.toMatch(/bg-muted(?![-\w])/);
    expect(header).toContain("aria-current={current ? 'true' : undefined}");
    expect(header).toContain('{conversation.title}');
    expect(header).toContain('formatRecent(conversation.lastActivityAt)');
  });

  it('an unsaved conversation is titled New chat, and New chat is an unsaved state that focuses the composer', () => {
    expect(tenantRail).toContain(": 'New chat';");
    const newChat = between(tenantRail, 'function newChat', '}\n\n  const title');
    expect(newChat).toContain("setView({ kind: 'new' })");
    expect(newChat).toContain('composer.current?.focus()');
    expect(newChat).not.toMatch(/Action\(|createAgentConversation/);
  });

  it('selecting a conversation loads its transcript on demand, and puts no id in any URL', () => {
    expect(tenantRail).toContain('openConversationAction(organizationId, conversationId)');
    expect(code(tenantRail)).not.toMatch(/router\.(push|replace)|searchParams|useSearchParams/);
    expect(code(actions)).not.toMatch(/redirect\(/);
  });
});

describe('the transcript is the shared Message Scroller', () => {
  const transcript = between(shared, 'export function AgentTranscript', 'function QuestionMessage');

  it('is the only scroller: the transcript uses it and nothing around it scrolls', () => {
    expect(transcript).toContain('<MessageScrollerProvider');
    expect(transcript).toContain('<MessageScrollerViewport');
    expect(transcript).toContain('<MessageScrollerItem');
    expect(code(transcript)).not.toContain('overflow-y-auto');
    expect(code(tenantRail)).not.toContain('overflow-y-auto');
    expect(code(tenantRail)).not.toContain('overflow-auto');
  });

  it('puts questions at the end and the Agent’s words at the start', () => {
    expect(shared).toContain('<Message align="end">');
    expect(shared).toContain('<Bubble variant="secondary" align="end"');
    expect(shared).toMatch(/<Message>\s*<MessageContent>\s*<Bubble variant="outline"/);
  });

  it('adds no avatars, reactions, delivery states or regeneration', () => {
    expect(code(shared)).not.toMatch(/Avatar|Reaction|regenerate|Regenerate|Delivered|Seen|Retry/);
  });

  it('marks only concise events, never a tool-call audit trail', () => {
    expect(shared).toContain('Thinking…');
    expect(shared).toContain("import { runEvents, type RunEvent } from './run-events';");
    expect(code(shared)).not.toMatch(/\.tools\.map|call\.tool|call\.arguments/);
  });

  it('keeps the recorded tool facts on the run — retiring Activity from the rail deleted none of them', () => {
    expect(code(questions)).toMatch(/tools: tools as unknown as Json/);
    expect(code(questions)).toContain("tools: (row.tools ?? []) as ToolCallRecord[]");
  });

  it('keeps a proposed action directly beneath its response, with shared Buttons, behind the human approval', () => {
    const turn = between(shared, 'function TurnItems', 'function EventMarker');
    expect(turn.indexOf('{run.answer}')).toBeLessThan(turn.indexOf('name="decision"'));
    expect(turn).toContain('<Button type="submit" name="decision" value="decline"');
    expect(turn).toContain('<Button type="submit" name="decision" value="carry-out"');
    expect(turn).toContain('Decline');
    expect(turn).toContain('Approve');
    // Nothing here performs anything: the form posts to the decide action and to nothing else.
    expect(turn).toContain('<form action={decideFormAction}');
    expect(code(shared)).not.toContain('executorFor');
  });
});

describe('the composer', () => {
  const composer = between(shared, 'export function AgentComposer', 'export function AgentToolPopover');

  it('sends on Enter, adds a line on Shift+Enter, and grows to a bound', () => {
    expect(composer).toContain("event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing");
    expect(composer).toContain('requestSubmit()');
    expect(composer).toContain('COMPOSER_MAX_HEIGHT');
    expect(shared).toMatch(/COMPOSER_MAX_HEIGHT = \d+/);
  });

  it('is a textarea above a toolbar: tools on the left, Send on the right', () => {
    expect(composer.indexOf('<TextArea')).toBeLessThan(composer.indexOf('{tools}'));
    expect(composer.indexOf('{tools}')).toBeLessThan(composer.indexOf('Send'));
  });

  it('has a paperclip only because the whole path behind it exists', () => {
    // Choose → upload privately → card with its state → sent with the question → persisted → shown again.
    expect(composer).toContain('<Paperclip');
    expect(composer).toContain('aria-label="Attach files"');
    expect(tenantRail).toContain('uploadAttachmentAction(body)');
    expect(actions).toContain('uploadAgentAttachment(db');
    expect(code(questions)).toContain('readAttachmentsForQuestion(db');
    expect(code(questions)).toContain('linkAttachmentsToRun(db');
    expect(code(questions)).toContain('listAttachmentsByRun(db');
    expect(shared).toContain('attachments={run.attachments}');
  });

  it('shows the files above the textarea, and lets a person take one back before sending', () => {
    expect(composer.indexOf('<ComposerAttachments')).toBeLessThan(composer.indexOf('<TextArea'));
    expect(shared).toContain('Cancel ${file.name}');
    expect(shared).toContain('Remove ${file.name}');
    expect(tenantRail).toContain('removeAttachmentAction(organizationId');
  });

  it('never submits file bytes with the question: the picker has no name, and the question carries ids', () => {
    const start = composer.indexOf('ref={picker}');
    const picker = composer.slice(start, composer.indexOf('/>', start));
    expect(picker).toContain('type="file"');
    expect(picker).not.toMatch(/\bname=/);
    expect(composer).toContain('name="documentId"');
  });

  it('will not send while a file is still uploading', () => {
    expect(composer).toContain("const uploading = attachments.some((file) => file.state === 'uploading');");
    expect(composer).toContain('disabled={disabled || pending || uploading}');
  });

  it('keeps the cards inside a 320px rail: they wrap, and never scroll sideways', () => {
    const group = readFileSync(`${UI}/src/components/attachment.tsx`, 'utf8');
    expect(code(group)).toContain('flex min-w-0 flex-wrap gap-2');
    expect(code(group)).not.toMatch(/overflow-x-auto|snap-x/);
    expect(shared).toContain('className="max-w-full"');
  });

  it('accepts only what the Agent can read, and asks the browser for the same', () => {
    expect(composer).toContain('accept={ATTACHMENT_ACCEPT}');
    // The set is the file registry's `agent_attachment` consumer: text-shaped formats only.
    const accepted = formatsFor('agent_attachment');
    expect(accepted.map((format) => format.mimeType)).toContain('text/csv');
    expect(accepted.map((format) => format.id).join()).not.toMatch(/pdf|png|jpe?g|docx/);
  });

  it('keeps role refusal, pending and error behaviour', () => {
    expect(tenantRail).toContain('disabled={!mayAsk || !canAnswer}');
    expect(tenantRail).toContain("'Your role cannot ask questions here.'");
    expect(composer).toContain("{pending ? 'Sending…' : 'Send'}");
    expect(composer).toContain('disabled={disabled || pending || uploading}');
    expect(tenantRail).toContain('{askError}');
    expect(tenantRail).toContain('role="alert"');
  });

  it('when the deployment cannot answer, keeps the whole conversation and switches only asking off', () => {
    // The placeholder that hid History, the composer and the paperclip is what made the panel look
    // empty on a machine with no assistant configured. It is no longer reachable from a business.
    expect(code(tenantRail)).not.toContain('<AgentUnavailable');
    expect(tenantRail).toContain('disabled={!mayAsk || !canAnswer}');
    expect(tenantRail).toContain('Agent is currently unavailable, so questions cannot be sent right now.');
    expect(tenantRail.indexOf('<AgentConversationHeader')).toBeGreaterThan(-1);
  });

  it('names the conversation it asks into, and the page it was asked from', () => {
    expect(tenantRail).toContain('name="conversationId"');
    expect(tenantRail).toContain('name="pathname"');
  });
});

describe('Context and Configure are composer popovers, and inspection only', () => {
  const tools = between(tenantRail, 'tools={', '</AgentComposer') || tenantRail.slice(tenantRail.indexOf('tools={'));

  it('sit beside each other on the left of the toolbar', () => {
    expect(tools.indexOf('label="Context"')).toBeGreaterThan(-1);
    expect(tools.indexOf('label="Configure"')).toBeGreaterThan(tools.indexOf('label="Context"'));
  });

  it('Context shows only facts GOLD has, and follows the page as navigation changes', () => {
    expect(tenantRail).toContain('const pathname = usePathname();');
    expect(tenantRail).toContain('resolveAgentViewing(pathname)');
    for (const label of ['Business', 'Current workspace', 'Open record', 'Business time zone']) {
      expect(tenantRail).toContain(`label: '${label}'`);
    }
    // No row for something that does not exist yet.
    expect(tenantRail).not.toMatch(/label: '(Attached|Attachments|Connected)/);
  });

  it('tells the answering side only what Context shows, derived on the server from the path', () => {
    expect(actions).toContain("resolveAgentViewing(String(formData.get('pathname') ?? ''))");
    expect(questions).toContain('describeViewing(input.viewing)');
  });

  it('Configure exposes only what has a behaviour behind it, and links to where durable settings live', () => {
    const configure = tenantRail.slice(tenantRail.indexOf('label="Configure"'));
    expect(configure).toContain('Include the open record');
    expect(configure).toContain('/settings/connections');
    expect(configure).toContain('Connections &amp; permissions');
    // No control for a behaviour that does not exist.
    expect(configure).not.toMatch(/verbosity|Verbosity|Style|style|Approved tools|suggested actions/i);
  });

  it('never exposes provider secrets or GOLD’s provider economics', () => {
    expect(code(tenantRail + shared)).not.toMatch(/secret|provider_cost|margin|api[_ -]?key|token/i);
  });

  it('fits inside the rail: never wider than the space it is given, and opens above the composer', () => {
    const popover = between(shared, 'export function AgentToolPopover', 'export function AgentContextFacts');
    expect(popover).toContain('max-w-(--radix-popover-content-available-width)');
    expect(popover).toContain('collisionPadding={8}');
    expect(popover).toContain('side="top"');
  });
});

describe('the shell holds no Agent transcript, and the rail fetches its own on first open', () => {
  it('the shell never reads a conversation, a run, or whether the Agent can answer', () => {
    // Eager shell-time Agent data was the N+1 the lazy bootstrap replaced (Phase C, Slice 12):
    // every organization page load once paid for History and a transcript nobody had opened yet.
    expect(code(layout)).not.toMatch(/listAgentConversationSummaries|listAgentConversationRuns|canAnswerQuestions|canAnswerPlatformQuestions/);
  });

  it('TenantAgentRail\'s shell-time props are static only — no eager canAnswer, conversations or transcript', () => {
    const shell = code(layout);
    const element = shell.slice(shell.indexOf('<TenantAgentRail'), shell.indexOf('/>', shell.indexOf('<TenantAgentRail')));
    expect(element).not.toMatch(/canAnswer|conversations|initialConversation/);
    expect(element).toMatch(/organizationId/);
    expect(element).toMatch(/mayAsk/);
  });

  it('fetches summaries and only the latest transcript lazily, from one bootstrap action, never every run', () => {
    expect(actions).toContain('export async function loadAgentBootstrapAction');
    const bootstrap = actions.slice(
      actions.indexOf('export async function loadAgentBootstrapAction'),
      actions.indexOf('export async function loadPlatformAgentAvailabilityAction'),
    );
    expect(bootstrap).toContain('listAgentConversationSummaries(db, { organizationId })');
    expect(bootstrap.match(/listAgentConversationRuns\(/g)?.length).toBe(1);
    expect(actions).not.toContain('listAgentRuns');
    expect(questions).not.toMatch(/export async function listAgentRuns/);
    expect(questions).toMatch(/CONVERSATION_RUN_LIMIT = \d+/);
  });

  it('the rail defers that fetch until the panel has actually been opened once', () => {
    expect(tenantRail).toContain('agentOpen');
    expect(tenantRail).toContain('everOpened');
    expect(tenantRail).toContain('loadAgentBootstrapAction(organizationId)');
    expect(tenantRail).toMatch(/if \(!everOpened\) return null;|if \(!everOpened\)/);
  });

  it('the Platform Agent proves its own platform scope and defers the same way', () => {
    expect(actions).toContain('export async function loadPlatformAgentAvailabilityAction');
    expect(actions).toContain('requirePlatformScope(goldId)');
    expect(platformRail).toContain('everOpened');
    expect(platformRail).toContain('loadPlatformAgentAvailabilityAction(goldId)');
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

  it('hands History its refreshed state directly, rather than revalidating a layout the rail no longer depends on', () => {
    expect(code(actions)).not.toMatch(/revalidatePath/);
    expect(tenantRail).toContain('setConversationList(result.conversations)');
  });

  it('shows the question at once with a Thinking note until it is answered', () => {
    expect(tenantRail).toContain("setPendingQuestion({ text: String(formData.get('question') ?? '').trim(), attachments: sending })");
    expect(tenantRail).toContain('setPendingQuestion(null)');
  });
});

describe('Platform Agent has no organization-backed shortcut', () => {
  it('reads no conversation, composer, action or tenant answering code', () => {
    const source = code(platformRail);
    expect(source).not.toMatch(/askAction|openConversationAction|decideAction/);
    expect(source).not.toMatch(/AgentConversationHeader|AgentComposer|AgentTranscript|conversationId|listAgentConversation/);
    expect(source).not.toContain('@/lib/domain/assistant/questions');
    expect(source).not.toContain('organizationId:');
  });

  it('stays honestly unavailable until a platform-scoped endpoint exists', () => {
    const source = code(platformQuestions);
    expect(source).toMatch(/return false;/);
    expect(source).not.toMatch(/import /);
    expect(source).not.toContain('askQuestion');
    expect(source).not.toContain('agent_conversations');
    expect(code(platformRail)).toContain('<AgentUnavailable configureHref={configureHref} />');
  });

  it('the shell hands the Platform Agent no organization and no conversation, and mounts one Agent by route', () => {
    const shell = code(read('features/shell/organization-shell.tsx'));
    const platformElement = shell.slice(shell.indexOf('<PlatformAgentRail'), shell.indexOf('/>', shell.indexOf('<PlatformAgentRail')));
    expect(platformElement).toContain("platformHref(organizationId, 'providers')");
    expect(platformElement).not.toMatch(/conversation|organizationName|timezone|mayAsk/i);
    // Built only for an operator inside GOLD's own organization; everywhere else the tenant Agent is the only one.
    expect(shell).toMatch(/platform && platform\.size > 0 \? \(\s*<PlatformAgentRail/);

    const host = code(read('features/agent/route-aware-agent.tsx'));
    expect(host).toContain('inPlatformScope(pathname)');
    // A choice between two elements, never both: two mounted rails would race to register the one panel.
    expect(host).toMatch(/\? platform : organization/);
    expect(host).not.toMatch(/<TenantAgentRail|<PlatformAgentRail|listAgentConversation/);
  });
});

describe('the chat components live in @gold/ui, on GOLD’s roles', () => {
  const ui = (name: string) => readFileSync(`${UI}/src/components/${name}.tsx`, 'utf8');
  const manifest = JSON.parse(readFileSync(`${UI}/package.json`, 'utf8')) as { exports: Record<string, string> };

  it('exports Message, Bubble, Message Scroller and Marker as subpaths, never a barrel', () => {
    for (const name of ['message', 'bubble', 'message-scroller', 'marker', 'attachment']) {
      expect(manifest.exports[`./components/${name}`]).toBe(`./src/components/${name}.tsx`);
    }
    expect(Object.keys(manifest.exports)).not.toContain('.');
  });

  it('uses no demo blue, no muted surface, and no reactions or avatars', () => {
    for (const name of ['message', 'bubble', 'message-scroller', 'marker', 'attachment']) {
      const source = ui(name);
      expect(source).not.toMatch(/bg-muted(?![-\w])|blue-|oklch\(from var\(--primary\)/);
    }
    expect(code(ui('bubble'))).not.toContain('BubbleReactions');
    expect(code(ui('message'))).not.toContain('MessageAvatar');
  });
});
