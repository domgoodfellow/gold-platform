import { createHmac, randomUUID } from 'node:crypto';
import type { CallStatus, PlacedCall, TelephonyProvider } from './index';

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
}): TelephonyProvider {
  const basic = Buffer.from(`${config.account}:${config.token}`).toString('base64');

  return {
    async addToRoom(input): Promise<PlacedCall> {
      // Adding a participant creates the room if it does not exist, so there is nothing to
      // create first and no window in which a room exists with nobody in it.
      const response = await fetch(
        `${API}/Accounts/${config.account}/Conferences/${encodeURIComponent(input.room)}/Participants.json`,
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
  };
}
