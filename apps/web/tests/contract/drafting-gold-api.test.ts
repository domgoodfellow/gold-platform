import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftingNotEntitledError, type DraftingRequest } from '@/lib/adapters/drafting';
import { draftingProvider } from '@/lib/adapters/drafting/registry';
import { goldApiDraftingProvider } from '@/lib/adapters/drafting/gold-api';

/**
 * What configuration drafting sends `apps/api` and how it reads the reply, offline. `fetch` is
 * replaced. The model, the provider and the key are the far side's; the claims here are that this
 * side names none of them, forwards the caller's own token, and treats the reply as a request for a
 * shape that still has to be narrowed into the domain's own types.
 */

const BASE = 'http://assistant.test';
const REQUEST: DraftingRequest = {
  description: 'We repair boats.',
  organizationId: 'org-1',
  token: 'the-callers-token',
  business: { name: 'Quay Marine', currency: 'EUR', timeZone: 'Europe/Amsterdam' },
  current: null,
};

const SHAPE = {
  typeName: 'Repair',
  schedulable: true,
  statuses: ['Booked in', 'Ready'],
  transitions: [[0, 1]],
  fields: {},
  prices: [],
  hours: [],
  roles: [],
  automations: [],
  modules: [],
};

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function stubApi(reply: Response): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return reply;
  });
  return sent;
}

const provider = goldApiDraftingProvider({ baseUrl: BASE });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('asking apps/api to draft', () => {
  it('sends the callers own token and the business to ask about, and never a model, a provider or a key', async () => {
    const sent = stubApi(new Response(JSON.stringify({ outcome: 'declined' })));

    await provider.draft(REQUEST);

    expect(sent[0].url).toBe(`${BASE}/ai/draft-configuration`);
    expect(sent[0].headers.authorization).toBe('Bearer the-callers-token');
    expect(Object.keys(sent[0].body).sort()).toEqual(['organization_id', 'question', 'schema']);
    expect(sent[0].body.organization_id).toBe('org-1');
    expect(JSON.stringify(sent[0].body)).not.toMatch(/claude|gpt|gemini|api[_-]?key/i);
  });

  it('puts what the business said in the question, and the domains own vocabulary in the schema', async () => {
    const sent = stubApi(new Response(JSON.stringify({ outcome: 'declined' })));

    await provider.draft(REQUEST);

    expect(String(sent[0].body.question)).toContain('Quay Marine');
    expect(String(sent[0].body.question)).toContain('We repair boats.');
    const schema = sent[0].body.schema as { properties: { shape: { properties: Record<string, unknown> } } };
    // Built from the domain's own lists, so a module or capability added to the platform is offered.
    expect(Object.keys(schema.properties.shape.properties)).toEqual(
      expect.arrayContaining(['typeName', 'statuses', 'roles', 'modules']),
    );
  });

  it('reads a drafted configuration into the domains own types', async () => {
    stubApi(
      new Response(
        JSON.stringify({ outcome: 'drafted', configuration: { shape: SHAPE, gaps: [{ field: 'prices', question: 'What do you charge?' }] } }),
      ),
    );

    const drafted = await provider.draft(REQUEST);

    expect(drafted?.shape.statuses).toEqual(['Booked in', 'Ready']);
    expect(drafted?.shape.transitions).toEqual([[0, 1]]);
    expect(drafted?.gaps).toEqual([{ field: 'prices', question: 'What do you charge?' }]);
  });

  it('treats a malformed configuration as a decline, the answer this path always gave', async () => {
    stubApi(new Response(JSON.stringify({ outcome: 'drafted', configuration: { shape: { statuses: 'nope' } } })));

    await expect(provider.draft(REQUEST)).resolves.toBeNull();
  });

  it('treats a model that would not draft as null, which is an answer and not an error', async () => {
    stubApi(new Response(JSON.stringify({ outcome: 'declined', detail: 'I cannot do that.' })));

    await expect(provider.draft(REQUEST)).resolves.toBeNull();
  });

  it('throws for anything that broke, which is not a decline', async () => {
    stubApi(new Response(JSON.stringify({ outcome: 'failed', detail: 'the model is down' })));
    await expect(provider.draft(REQUEST)).rejects.toThrow('the model is down');

    stubApi(new Response(JSON.stringify({ error: 'no model configured' }), { status: 503 }));
    await expect(provider.draft(REQUEST)).rejects.toThrow('no model configured');
  });

  it('says so, in its own error, when the business does not hold guided setup', async () => {
    stubApi(new Response(JSON.stringify({ error: 'no', code: 'not_entitled' }), { status: 403 }));

    await expect(provider.draft(REQUEST)).rejects.toBeInstanceOf(DraftingNotEntitledError);
  });

  it('is not retried: a second attempt nobody asked for is a second bill', async () => {
    const sent = stubApi(new Response(JSON.stringify({ error: 'down' }), { status: 503 }));

    await expect(provider.draft(REQUEST)).rejects.toThrow();

    expect(sent).toHaveLength(1);
  });
});

describe('which implementation drafts', () => {
  it('is whichever apps/api answers, decided by whether it is reachable and by nothing about a model key', async () => {
    vi.stubEnv('ASSISTANT_API_URL', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-set-but-irrelevant');
    expect(await draftingProvider()).toBeNull();

    vi.stubEnv('ASSISTANT_API_URL', BASE);
    expect((await draftingProvider())?.name).toBe('gold');
  });
});
