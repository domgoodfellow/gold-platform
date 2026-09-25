import type { PlatformEmail, PlatformEmailSender } from './index';

/** Resend, behind the capability its interface names — one of two files that knows this vendor exists (I15). No SDK: one HTTPS call. */

const API = 'https://api.resend.com/emails';

export function resendPlatformEmailSender(config: {
  apiKey: string;
  sender: string;
}): PlatformEmailSender {
  return {
    name: 'Resend',

    async send(email: PlatformEmail): Promise<void> {
      const response = await fetch(API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.sender,
          to: email.to,
          subject: email.subject,
          text: email.text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Sending GildOps's own email failed with status ${response.status}.`);
      }
    },
  };
}
