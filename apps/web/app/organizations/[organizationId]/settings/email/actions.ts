'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  applySendingDomainDns,
  checkSendingDomain,
  releaseSendingDomain,
  requestSendingDomain,
  type SendingDomainOutcome,
} from '@/lib/domain/email/sending-domains';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The Email page's server actions. Each proves the business and its service access first
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
