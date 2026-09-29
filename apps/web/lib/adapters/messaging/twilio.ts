import type { MessageStatus, MessagingProvider, SentMessage } from './index';

/**
 * Twilio, behind the capability its interface names — the messaging analogue of `../telephony/twilio.ts`.
 *
 * **No SDK**, for the same reason the telephony adapter gives: one HTTPS call, one form
 * encoding, all stable and specified.
 */

const API = 'https://api.twilio.com/2010-04-01';

function status(theirs: string): MessageStatus {
  switch (theirs) {
    case 'accepted':
    case 'queued':
      return 'queued';
    case 'sending':
      return 'sending';
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'undelivered':
      return 'undelivered';
    default:
      return 'failed';
  }
}

export function twilioMessaging(config: { account: string; token: string }): MessagingProvider {
  const basic = Buffer.from(`${config.account}:${config.token}`).toString('base64');

  return {
    async sendMessage(input): Promise<SentMessage> {
      const response = await fetch(`${API}/Accounts/${config.account}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: input.from,
          To: input.to,
          Body: input.body,
          StatusCallback: `${input.reportTo}/sms/status`,
        }).toString(),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`messaging refused the send (${response.status}): ${detail}`);
      }

      const body = (await response.json()) as { sid?: unknown; status?: unknown };
      if (typeof body.sid !== 'string') {
        throw new Error('messaging accepted the send but returned no identifier for it');
      }

      return { externalId: body.sid, status: status(typeof body.status === 'string' ? body.status : '') };
    },
  };
}
