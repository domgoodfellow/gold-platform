import { callDomainCommand } from '@/lib/api/client';
import type {
  ProviderAccountVerification,
  RemoteSubaccount,
  TelephonyAccountOperations,
} from './index';

/**
 * Twilio's parent account, addressed through `apps/api`.
 *
 * **No credential is here and none can be.** Every method is one call to `/providers/operate`
 * carrying the operator's own token and an account id; `apps/api` proves the caller is staff,
 * reads the credential from Vault and talks to the carrier. This file only translates between
 * that command's JSON and the capability's types.
 */
export function twilioAccountOperations(input: {
  token: string;
  accountId: string;
}): TelephonyAccountOperations {
  function operate<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    return callDomainCommand<T>('/providers/operate', {
      token: input.token,
      body: { account_id: input.accountId, operation, arguments: args },
    });
  }

  return {
    verify: () => operate<ProviderAccountVerification>('verify'),

    async listSubaccounts(): Promise<RemoteSubaccount[]> {
      const result = await operate<{
        subaccounts: { sid: string; friendly_name: string | null; status: string | null }[];
      }>('list_subaccounts');
      return result.subaccounts.map((row) => ({
        sid: row.sid,
        friendlyName: row.friendly_name,
        status: row.status,
      }));
    },

    provisioner: {
      createSubaccount: (args) => operate('create_subaccount', { friendly_name: args.friendlyName }),
      createApiKey: (args) =>
        operate('create_api_key', { subaccount_sid: args.subaccountSid, friendly_name: args.friendlyName }),
      createTwimlApp: (args) =>
        operate('create_twiml_app', {
          subaccount_sid: args.subaccountSid,
          friendly_name: args.friendlyName,
          voice_url: args.voiceUrl,
        }),
    },
  };
}
