'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  applySendingDomainDns,
  checkSendingDomain,
  listSendingDomains,
  releaseSendingDomain,
  requestSendingDomain,
  type SendingDomainOutcome,
} from '@/lib/domain/email/sending-domains';
import { createEmailIdentity, setEmailIdentityReceiving } from '@/lib/domain/email/identities';
import { sendTestEmail, setDefaultEmailSender, setEmailReplyTo } from '@/lib/domain/email/sender';
import { requireOrganization } from '@/lib/route/organization';

/**
 * Email sending settings' server actions, and the Inbox email page's receiving switch. Each proves the business and its service access first
 * (`requireOrganization`), then calls the domain layer, which decides everything else; a refusal
 * comes back as a sentence, never as a thrown page.
 */

export type EmailDomainState = { error: string | null; notice: string | null; done: boolean };

function words(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  return 'That could not be completed.';
}

function refresh(organizationId: string) {
  revalidatePath(`/organizations/${organizationId}/settings/email`);
  revalidatePath(`/organizations/${organizationId}/comms/configuration/email`);
}

/**
 * What an outcome reads as once the row has already been updated behind it. An `ok` outcome is
 * not automatically good news: the provider may have taken the domain and still be waiting on
 * DNS, which is the ordinary case and not an error.
 */
function settle(outcome: SendingDomainOutcome): EmailDomainState {
  switch (outcome.kind) {
    case 'ok':
      return { error: null, notice: null, done: true };
    case 'provider_unavailable':
    case 'rejected':
    case 'provider_error':
      return { error: outcome.message, notice: null, done: false };
  }
}

export async function requestSendingDomainAction(
  _previous: EmailDomainState,
  form: FormData,
): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    const outcome = await requestSendingDomain(await getDb(), {
      organizationId,
      domain: String(form.get('domain') ?? ''),
    });
    refresh(organizationId);
    return settle(outcome);
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

export async function checkSendingDomainAction(
  _previous: EmailDomainState,
  form: FormData,
): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    const outcome = await checkSendingDomain(await getDb(), {
      organizationId,
      resourceId: String(form.get('resourceId') ?? ''),
    });
    refresh(organizationId);
    return settle(outcome);
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

/**
 * "Apply and verify", pressed only after a person has read the records this would publish — the
 * one action in this file that writes DNS.
 *
 * A record GildOps could not prove it owns is refused by the DNS capability rather than
 * overwritten, and that refusal is the one thing the row itself cannot say afterwards (the row
 * holds what the provider wants, not what somebody else's zone already has). So it is reported
 * here, named record by record, instead of leaving a person with a domain that silently will not
 * verify.
 */
export async function applySendingDomainDnsAction(
  _previous: EmailDomainState,
  form: FormData,
): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    const outcome = await applySendingDomainDns(await getDb(), {
      organizationId,
      resourceId: String(form.get('resourceId') ?? ''),
    });
    refresh(organizationId);
    if (outcome.kind !== 'ok') return settle(outcome);

    const unfinished = (outcome.standing.dnsOutcome?.records ?? []).filter(
      (record) => record.outcome === 'conflict' || record.outcome === 'failed',
    );
    if (unfinished.length === 0) return { error: null, notice: null, done: true };

    return {
      error: null,
      done: true,
      notice: `${unfinished.length} record${unfinished.length === 1 ? ' needs' : 's need'} attention at your DNS host: ${unfinished
        .map((record) => `${record.type} ${record.name} — ${record.message ?? 'could not be published'}`)
        .join('; ')}`,
    };
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

export async function releaseSendingDomainAction(
  _previous: EmailDomainState,
  form: FormData,
): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    await releaseSendingDomain(await getDb(), {
      organizationId,
      resourceId: String(form.get('resourceId') ?? ''),
    });
    refresh(organizationId);
    return { error: null, notice: null, done: true };
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

/**
 * Name an address beneath a sending domain this business already holds. The form has a local part and
 * a domain *the business chose from its own list*; the database refuses an address that is not beneath
 * the domain it names, so the form is a convenience and not the guard.
 */
export async function addEmailAddressAction(_previous: EmailDomainState, form: FormData): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    const db = await getDb();
    const resourceId = String(form.get('resourceId') ?? '');
    // The domain is read back from the business's own list by the id it chose, never taken from the form.
    const domain = (await listSendingDomains(db, organizationId)).find((candidate) => candidate.resourceId === resourceId)?.domain;
    if (!domain) return { error: 'Choose one of this business’s sending domains.', notice: null, done: false };
    const local = String(form.get('local') ?? '').trim().toLowerCase();
    await createEmailIdentity(db, {
      organizationId,
      address: `${local}@${domain}`,
      displayName: String(form.get('displayName') ?? ''),
      sendingDomainResourceId: resourceId,
    });
    refresh(organizationId);
    return { error: null, notice: null, done: true };
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

export async function setEmailReceivingAction(_previous: EmailDomainState, form: FormData): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    await setEmailIdentityReceiving(await getDb(), {
      organizationId,
      emailIdentityId: String(form.get('emailIdentityId') ?? ''),
      canReceive: String(form.get('canReceive') ?? '') === 'true',
    });
    refresh(organizationId);
    return { error: null, notice: null, done: true };
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

/** The business's default sender: one of its own ready addresses (`set_default_email_sender`). */
export async function setDefaultEmailSenderAction(_previous: EmailDomainState, form: FormData): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    await setDefaultEmailSender(await getDb(), { organizationId, emailIdentityId: String(form.get('emailIdentityId') ?? '') });
    refresh(organizationId);
    return { error: null, notice: 'Default sender saved.', done: true };
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

/** Where replies go (`set_email_reply_to`): one of the business's addresses on a proved domain, or the From address. */
export async function setEmailReplyToAction(_previous: EmailDomainState, form: FormData): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    const chosen = String(form.get('emailIdentityId') ?? '');
    await setEmailReplyTo(await getDb(), { organizationId, emailIdentityId: chosen || null });
    refresh(organizationId);
    return { error: null, notice: chosen ? 'Replies will go to the chosen address.' : 'Replies will go to the From address.', done: true };
  } catch (error) {
    return { error: words(error), notice: null, done: false };
  }
}

/** One test email to the caller's own address. What happened is said plainly, never as "delivered". */
export async function sendTestEmailAction(_previous: EmailDomainState, form: FormData): Promise<EmailDomainState> {
  const organizationId = String(form.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  try {
    const outcome = await sendTestEmail(await getDb(), organizationId);
    refresh(organizationId);
    if (outcome.state === 'sent') return { error: null, notice: `Test email accepted for delivery to ${outcome.recipient}. Check that inbox; whether it arrived is shown below once the provider reports it.`, done: true };
    if (outcome.state === 'uncertain') return { error: `The test may or may not have been sent: ${outcome.detail ?? 'the provider did not confirm it'}. Check ${outcome.recipient} before trying again.`, notice: null, done: false };
    return { error: `The test email was not sent: ${outcome.detail ?? 'the provider did not say why'}`, notice: null, done: false };
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'api.unreachable' || error.code === 'api.unconfigured')) {
      return { error: 'GildOps’ email service could not be reached, so no test was sent.', notice: null, done: false };
    }
    return { error: words(error), notice: null, done: false };
  }
}
