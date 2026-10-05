import { createHmac, randomUUID } from 'node:crypto';
import type {
  CallStatus,
  PlacedCall,
  ProvisionedApiKey,
  ProvisionedSubaccount,
  ProvisionedTwimlApp,
  TelephonyProvider,
  TelephonyProvisioner,
} from './index';

/**
 * Twilio, behind the capability its interface names.
 *
 * **The only file in `apps/web` that knows Twilio carries voice.** Everything above it asks for
 * somebody to be rung into a room, and I15 is the test that keeps it that way.
 *
 * **No SDK**, for the reason the payment adapter gives: this is one HTTPS call, one form
 * encoding and one signed token, all stable and specified. An SDK would add a transitive
 * surface nothing here uses, and it would want a network at import time.
 *
 * **Only the outbound half is here.** What the carrier sends back when a call progresses is
 * webhook ingress, which is `apps/api`'s by D2 and D26 — so this file makes requests and never
 * reads a callback. The mapping between their words and ours therefore exists twice, once on
 * each side, and that is the cost of the split rather than a duplication to remove: neither
 * runtime can call the other (D30).
 */

const API = 'https://api.twilio.com/2010-04-01';

function status(theirs: string): CallStatus {
  switch (theirs) {
    case 'queued':
    case 'initiated':
    case 'ringing':
      return 'ringing';
    case 'in-progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'no-answer':
      return 'no_answer';
    case 'busy':
      return 'busy';
    default:
      return 'failed';
  }
}

/** Base64url, which a JWT wants and `Buffer` does not produce by default. */
function segment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function twilioTelephony(config: {
  account: string;
  token: string;
  apiKeySid: string;
  apiKeySecret: string;
  appSid: string;
  /** A business's own subaccount, addressed with the master credentials above (D39). */
  actingAccountSid?: string | null;
}): TelephonyProvider {
  const basic = Buffer.from(`${config.account}:${config.token}`).toString('base64');
  const actingAccount = config.actingAccountSid || config.account;

  return {
    async addToRoom(input): Promise<PlacedCall> {
      // Adding a participant creates the room if it does not exist, so there is nothing to
      // create first and no window in which a room exists with nobody in it.
      const response = await fetch(
        `${API}/Accounts/${actingAccount}/Conferences/${encodeURIComponent(input.room)}/Participants.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: input.from,
            To: input.to,
            // The customer does not start the room and does not close it: they may answer
            // before the agent's browser has joined, and hearing hold music beats hearing the
            // line die.
            StartConferenceOnEnter: 'false',
            EndConferenceOnExit: 'false',
            StatusCallback: `${input.reportTo}/voice/status`,
            StatusCallbackEvent: 'initiated ringing answered completed',
            StatusCallbackMethod: 'POST',
            // Who is in the room is the carrier's fact, reported as people join and leave; the
            // call is settled from those, not from any one leg's own ending.
            ConferenceStatusCallback: `${input.reportTo}/voice/status`,
            ConferenceStatusCallbackEvent: 'join leave',
            ConferenceStatusCallbackMethod: 'POST',
            // Recording is asked for here rather than configured at the account, so a
            // deployment cannot be recording calls that this code does not know are recorded.
            Record: 'true',
            RecordingStatusCallback: `${input.reportTo}/voice/recording`,
            RecordingStatusCallbackMethod: 'POST',
          }).toString(),
        },
      );

      if (!response.ok) {
        // The carrier's own words, never a paraphrase. A rewritten message is the one thing
        // that makes a failing integration unreadable at three in the morning.
        const detail = await response.text();
        throw new Error(`telephony refused the call (${response.status}): ${detail}`);
      }

      const body = (await response.json()) as { call_sid?: unknown; status?: unknown };
      if (typeof body.call_sid !== 'string') {
        throw new Error('telephony accepted the call but returned no identifier for it');
      }

      return {
        externalId: body.call_sid,
        status: status(typeof body.status === 'string' ? body.status : ''),
      };
    },

    async browserToken(input): Promise<string> {
      // **Signed here rather than fetched**, which is why this needs an API key and not just
      // the account's auth token: the credential a browser holds is a JWT this server mints,
      // short-lived, naming exactly one person and one application.
      const now = Math.floor(Date.now() / 1000);
      const ttl = input.ttlSeconds ?? 3600;

      const header = segment({ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' });
      const payload = segment({
        jti: `${config.apiKeySid}-${randomUUID()}`,
        iss: config.apiKeySid,
        sub: config.account,
        iat: now,
        exp: now + ttl,
        grants: {
          identity: input.identity,
          voice: {
            outgoing: { application_sid: config.appSid },
            // So a number pointed at this application can reach the person as well as the
            // other way round. Which numbers do that is a tenant's configuration and does not
            // exist yet; the grant costs nothing until it does.
            incoming: { allow: true },
          },
        },
      });

      const signature = createHmac('sha256', config.apiKeySecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      return `${header}.${payload}.${signature}`;
    },

    async updateParticipant(input): Promise<void> {
      // Twilio's Conference resource takes either its SID or its friendly name in this path —
      // the same fact `addToRoom` above already relies on to avoid a second lookup.
      const form: Record<string, string> = {};
      if (input.hold !== undefined) form.Hold = String(input.hold);
      if (input.muted !== undefined) form.Muted = String(input.muted);
      if (input.status) form.Status = input.status;
      if (input.endsRoomOnExit !== undefined) form.EndConferenceOnExit = String(input.endsRoomOnExit);

      const response = await fetch(
        `${API}/Accounts/${actingAccount}/Conferences/${encodeURIComponent(input.room)}/Participants/${encodeURIComponent(input.externalId)}.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(form).toString(),
        },
      );

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`telephony refused to update the participant (${response.status}): ${detail}`);
      }
    },

    async fetchRecording(input) {
      // The reference came from a signed callback, but it is fetched with credentials, so it is
      // held to the carrier's own host rather than trusted to be one.
      const url = new URL(input.reference);
      if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com') {
        throw new Error('telephony will only fetch a recording from its own host');
      }
      const response = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
      if (!response.ok || !response.body) {
        throw new Error(`telephony could not return that recording (${response.status})`);
      }
      return { body: response.body, contentType: response.headers.get('content-type') ?? 'audio/mpeg' };
    },
  };
}

/**
 * Standing up a business's own scope inside GOLD's master account.
 *
 * **Three calls, all authenticated with the master credential, each addressing the new
 * subaccount by naming it in the path** — the same "parent credentials reach into a subaccount"
 * fact `twilioTelephony` above relies on for `addToRoom`. No SDK, for the reason the rest of this
 * file gives: one HTTPS call per step, stable and specified.
 *
 * **Each method is one Twilio call and nothing else.** Whether a subaccount already exists for a
 * retried provisioning attempt is `lib/domain/providers/twilio-provisioning.ts`'s question — this
 * file has no memory of anything and creates exactly what it is asked to.
 */
export function twilioProvisioner(config: { account: string; token: string }): TelephonyProvisioner {
  const basic = Buffer.from(`${config.account}:${config.token}`).toString('base64');

  async function post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`telephony provisioning refused (${response.status}): ${detail}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  return {
    async createSubaccount(input): Promise<ProvisionedSubaccount> {
      const body = await post('/Accounts.json', { FriendlyName: input.friendlyName });
      if (typeof body.sid !== 'string') {
        throw new Error('telephony provisioning created a subaccount with no identifier');
      }
      return { sid: body.sid };
    },

    async createApiKey(input): Promise<ProvisionedApiKey> {
      // The secret is returned exactly once, by Twilio's own design — never again, from Twilio
      // or from here. The caller must retain it now or it is gone.
      const body = await post(`/Accounts/${input.subaccountSid}/Keys.json`, {
        FriendlyName: input.friendlyName,
      });
      if (typeof body.sid !== 'string' || typeof body.secret !== 'string') {
        throw new Error('telephony provisioning created an API key with no identifier or secret');
      }
      return { sid: body.sid, secret: body.secret };
    },

    async createTwimlApp(input): Promise<ProvisionedTwimlApp> {
      const body = await post(`/Accounts/${input.subaccountSid}/Applications.json`, {
        FriendlyName: input.friendlyName,
        VoiceUrl: input.voiceUrl,
        VoiceMethod: 'POST',
      });
      if (typeof body.sid !== 'string') {
        throw new Error('telephony provisioning created an application with no identifier');
      }
      return { sid: body.sid };
    },
  };
}
