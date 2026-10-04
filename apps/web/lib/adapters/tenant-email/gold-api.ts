import { callDomainCommand } from '@/lib/api/client';
import { DomainError } from '@/lib/domain/errors';
import type { EmailOutcome, EmailProvider } from './index';

type Answer = { status: string; external_id?: string | null; detail?: string | null };

/**
 * Tenant email, through `apps/api`'s `/communications/email/send` — the same relay shape
 * `goldApiPlatformEmailSender` holds, one capability over. Names no vendor and sees no credential:
 * `apps/api` reads the queued message under the caller's own token, chooses the provider from what
 * sits beneath the address, and records the provider's answer itself.
 */
export function goldApiEmailProvider(input: { token: string }): EmailProvider {
  return {
    async sendEmail(target): Promise<EmailOutcome> {
      try {
        const answer = await callDomainCommand<Answer>('/communications/email/send', {
          token: input.token,
          body: { organization_id: target.organizationId, message_id: target.messageId },
        });

        if (answer.status === 'sent') return { status: 'accepted', externalId: answer.external_id ?? null };
        if (answer.status === 'rejected') return { status: 'rejected', detail: answer.detail ?? null };
        // `sending`, or already `delivered`/`bounced`: somebody has it, or it has gone.
        return { status: 'in_progress' };
      } catch (failure) {
        // A deployment the message cannot leave from is a state the sender can read, not a crash.
        if (failure instanceof DomainError && ['api.unconfigured', 'api.unreachable', 'api.provider_unavailable'].includes(failure.code)) {
          // The sentence a person reads, not the transport's: the message is saved and can be sent again.
          return { status: 'unavailable', detail: 'Email could not be sent just now. The message is saved; try sending it again.' };
        }
        throw failure;
      }
    },
  };
}
