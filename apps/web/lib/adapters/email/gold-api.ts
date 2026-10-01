import { callDomainCommand } from '@/lib/api/client';
import type { PlatformEmailReceipt, PlatformEmailSender } from './index';

type Answer = { sent: boolean; external_id: string | null };

/**
 * Platform email, through `apps/api`'s `/invitation_email` — the same relay shape
 * `goldApiDomainProvider` holds for a hosting credential, one axis over. This file names no
 * vendor and sees no credential; `apps/api` resolves GOLD's own Resend account (or its
 * environment-variable bootstrap fallback) and builds the email itself.
 */
export function goldApiPlatformEmailSender(input: { token: string }): PlatformEmailSender {
  return {
    name: 'GildOps API',

    async sendInvitationEmail(target): Promise<PlatformEmailReceipt> {
      const answer = await callDomainCommand<Answer>('/invitations/email', {
        token: input.token,
        body: { organization_id: target.organizationId, invitation_id: target.invitationId, link: target.link },
      });
      return { sent: answer.sent, externalId: answer.external_id };
    },
  };
}
