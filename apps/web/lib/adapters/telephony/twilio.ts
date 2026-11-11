import { callDomainCommand, callDomainStream } from '@/lib/api/client';
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
 * A business's calls, placed and controlled inside that business's own calling account.
 *
 * **No credential is here and none can be.** Every method is one call to `apps/api`'s
 * `/voice/operate`, carrying the asking person's own token and the business they are working in.
 * That runtime lets the database answer whether this person may use this business's telephone,
 * reads the business's own key from Vault and talks to the carrier. This file only translates
 * between that command's JSON and the capability's types, exactly as `twilio-accounts.ts` does
 * for GOLD's own account.
 *
 * **Only the outbound half is here.** What the carrier sends back when a call progresses is
 * webhook ingress, which is `apps/api`'s by the web/API runtime split and the authoritative-webhook rule.
 */
export function twilioTelephony(config: { token: string; organizationId: string }): TelephonyProvider {
  function operate<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    return callDomainCommand<T>('/voice/operate', {
      token: config.token,
      body: { organization_id: config.organizationId, operation, arguments: args },
    });
  }

  return {
    async addToRoom(input): Promise<PlacedCall> {
      const placed = await operate<{ external_id: string; status: CallStatus }>('add_to_room', {
        room: input.room,
        from: input.from,
        to: input.to,
      });
      return { externalId: placed.external_id, status: placed.status };
    },

    async browserToken(): Promise<string> {
      return (await operate<{ token: string }>('browser_token')).token;
    },

    async updateParticipant(input): Promise<void> {
      const args: Record<string, unknown> = { room: input.room, external_id: input.externalId };
      if (input.hold !== undefined) args.hold = input.hold;
      if (input.muted !== undefined) args.muted = input.muted;
      if (input.status) args.status = input.status;
      if (input.endsRoomOnExit !== undefined) args.ends_room_on_exit = input.endsRoomOnExit;
      await operate('update_participant', args);
    },

    fetchRecording(input) {
      return callDomainStream('/voice/operate', {
        token: config.token,
        body: { organization_id: config.organizationId, operation: 'recording', arguments: { call_id: input.callId } },
      });
    },
  };
}

const API = 'https://api.twilio.com/2010-04-01';

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
      if (typeof body.auth_token !== 'string' || !body.auth_token) {
        throw new Error('telephony provisioning created a subaccount with no signing secret');
      }
      return { sid: body.sid, signingSecret: body.auth_token };
    },

    async subaccountSigningSecret(input): Promise<string> {
      const response = await fetch(`${API}/Accounts/${input.subaccountSid}.json`, {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (!response.ok) {
        throw new Error(`telephony provisioning refused (${response.status}): ${await response.text()}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      if (typeof body.auth_token !== 'string' || !body.auth_token) {
        throw new Error('telephony provisioning returned no signing secret for that subaccount');
      }
      return body.auth_token;
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
