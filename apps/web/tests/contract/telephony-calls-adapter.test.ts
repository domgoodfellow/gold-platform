import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { twilioTelephony } from '@/lib/adapters/telephony/twilio';
import { telephonyProvider } from '@/lib/adapters/telephony';

/**
 * A business's calls leave this runtime as a request to `apps/api`, and as nothing else.
 *
 * The web application holds no carrier credential: the browser telephone's token is signed, calls
 * are placed and recordings are fetched by `apps/api`, which reads the business's own key. What is
 * checkable here, offline, is this side of that boundary — every operation goes to one address,
 * carries the asking person's own token and the business they are working in, and never an
 * address for the carrier to report to. What `apps/api` then does with it, including the signed
 * token's own shape, is held by `apps/api/tests/component/test_call_operations.py`.
 */

const TOKEN = 'the-persons-own-session-token';
const ORGANIZATION = '11111111-1111-4111-8111-111111111111';

type Sent = { url: string; authorization: string | null; body: { organization_id: string; operation: string; arguments: Record<string, unknown> } };

let sent: Sent[];
let answer: () => Response;

beforeEach(() => {
  sent = [];
  answer = () => Response.json({});
  vi.stubEnv('GOLD_API_URL', 'https://api.gold.example/');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    sent.push({
      url: String(url),
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)),
    });
    return answer();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const provider = () => twilioTelephony({ token: TOKEN, organizationId: ORGANIZATION });

describe('the calls adapter', () => {
  it('asks apps/api to ring a number into a room, as the person asking, for the business they are in', async () => {
    answer = () => Response.json({ external_id: 'CA1', status: 'ringing' });

    const placed = await provider().addToRoom({ room: 'gold-room', from: '+14165550100', to: '+14165550142' });

    expect(placed).toEqual({ externalId: 'CA1', status: 'ringing' });
    expect(sent).toEqual([
      {
        url: 'https://api.gold.example/voice/operate',
        authorization: `Bearer ${TOKEN}`,
        body: {
          organization_id: ORGANIZATION,
          operation: 'add_to_room',
          arguments: { room: 'gold-room', from: '+14165550100', to: '+14165550142' },
        },
      },
    ]);
  });

  it('never tells apps/api where the carrier should report', async () => {
    answer = () => Response.json({ external_id: 'CA1', status: 'ringing' });

    await provider().addToRoom({ room: 'gold-room', from: '+14165550100', to: '+14165550142' });

    expect(JSON.stringify(sent[0].body)).not.toMatch(/report|callback|https?:/i);
  });

  it('asks for a browser telephone without saying who the person is', async () => {
    answer = () => Response.json({ token: 'a.signed.token' });

    expect(await provider().browserToken()).toBe('a.signed.token');
    expect(sent[0].body).toEqual({ organization_id: ORGANIZATION, operation: 'browser_token', arguments: {} });
  });

  it('changes a leg by only the fields named', async () => {
    await provider().updateParticipant({ room: 'gold-room', externalId: 'CA9', hold: true });
    await provider().updateParticipant({ room: 'gold-room', externalId: 'CA9', status: 'completed', endsRoomOnExit: false });

    expect(sent[0].body.arguments).toEqual({ room: 'gold-room', external_id: 'CA9', hold: true });
    expect(sent[1].body.arguments).toEqual({ room: 'gold-room', external_id: 'CA9', status: 'completed', ends_room_on_exit: false });
  });

  it('asks for a recording by the call, never by the carrier’s own address', async () => {
    answer = () => new Response('audio', { headers: { 'content-type': 'audio/mpeg' } });

    const recording = await provider().fetchRecording({ callId: 'a-call' });

    expect(sent[0].body).toEqual({ organization_id: ORGANIZATION, operation: 'recording', arguments: { call_id: 'a-call' } });
    expect(recording?.contentType).toBe('audio/mpeg');
    expect(await new Response(recording?.body).text()).toBe('audio');
  });

  it('reads a call with no recording as nothing, and a refusal as a failure', async () => {
    answer = () => Response.json({ error: 'That call has no recording.', code: 'not_found' }, { status: 404 });
    expect(await provider().fetchRecording({ callId: 'a-call' })).toBeNull();

    answer = () => Response.json({ error: 'Twilio could not return that recording (500).', code: 'provider_refused' }, { status: 502 });
    await expect(provider().fetchRecording({ callId: 'a-call' })).rejects.toThrow('Twilio could not return that recording (500).');
  });

  it('passes on the carrier’s own words when it refuses', async () => {
    answer = () => Response.json({ error: 'Twilio refused the request (400): not your caller ID', code: 'provider_refused' }, { status: 502 });

    await expect(provider().addToRoom({ room: 'r', from: '+14165550100', to: '+14165550142' })).rejects.toThrow('not your caller ID');
  });

  it('holds no carrier credential: no deployment setting changes what it sends', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACdeployment');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'a-deployment-token');
    vi.stubEnv('TWILIO_API_KEY_SECRET', 'a-deployment-key-secret');
    answer = () => Response.json({ token: 'a.signed.token' });

    await provider().browserToken();

    expect(JSON.stringify(sent)).not.toMatch(/ACdeployment|a-deployment/);
    expect(sent[0].url.startsWith('https://api.gold.example/')).toBe(true);
  });
});

describe('the telephony registry', () => {
  it('offers no telephone on a deployment with no apps/api to ask', async () => {
    vi.stubEnv('GOLD_API_URL', '');

    expect(await telephonyProvider({ token: TOKEN, organizationId: ORGANIZATION })).toBeNull();
  });

  it('offers one built for the person and the business, whatever carrier settings the deployment holds', async () => {
    expect(await telephonyProvider({ token: TOKEN, organizationId: ORGANIZATION })).not.toBeNull();
  });
});
