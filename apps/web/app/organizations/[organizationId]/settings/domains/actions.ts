'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import {
  checkDomain,
  connectDomain,
  removeDomain,
  setPrimaryDomain,
  type DomainSurface,
} from '@/lib/domain/domains/domains';
import { requireOrganization } from '@/lib/route/organization';
import type { DomainActionResult } from '@/features/domains/connect-domain-flow';

/**
 * The Domains page's server actions. Each proves the business and its service access first
 * (`requireOrganization`), then calls the domain layer, which decides everything else; a refusal
 * comes back as a sentence, never as a thrown page.
 */

export type DomainCommandState = { error: string | null; done: boolean };

function words(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  return 'That could not be completed.';
}

function refresh(organizationId: string) {
  revalidatePath(`/organizations/${organizationId}/settings/domains`);
}

export async function connectDomainAction(input: {
  organizationId: string;
  hostname: string;
  surface: DomainSurface;
}): Promise<DomainActionResult> {
  const { db } = await requireOrganization(input.organizationId);
  try {
    const surface: DomainSurface = input.surface === 'portal' ? 'portal' : 'website';
    const outcome = await connectDomain(db, { organizationId: input.organizationId, hostname: input.hostname, surface });
    refresh(input.organizationId);
    return { ok: true, outcome };
  } catch (error) {
    return { ok: false, message: words(error) };
  }
}

export async function checkDomainAction(input: { organizationId: string; domainId: string }): Promise<DomainActionResult> {
  const { db } = await requireOrganization(input.organizationId);
  try {
    const outcome = await checkDomain(db, input);
    refresh(input.organizationId);
    return { ok: true, outcome };
  } catch (error) {
    return { ok: false, message: words(error) };
  }
}

export async function recheckDomainAction(_: DomainCommandState, form: FormData): Promise<DomainCommandState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
  try {
    const outcome = await checkDomain(db, { organizationId, domainId: String(form.get('domainId') ?? '') });
    refresh(organizationId);
    if (outcome.kind === 'active' || outcome.kind === 'pending_dns') return { error: null, done: true };
    return { error: outcome.message, done: false };
  } catch (error) {
    return { error: words(error), done: false };
  }
}

export async function removeDomainAction(_: DomainCommandState, form: FormData): Promise<DomainCommandState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
  try {
    await removeDomain(db, { organizationId, domainId: String(form.get('domainId') ?? '') });
    refresh(organizationId);
    return { error: null, done: true };
  } catch (error) {
    return { error: words(error), done: false };
  }
}

export async function setPrimaryDomainAction(_: DomainCommandState, form: FormData): Promise<DomainCommandState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
  try {
    await setPrimaryDomain(db, { organizationId, domainId: String(form.get('domainId') ?? '') });
    refresh(organizationId);
    return { error: null, done: true };
  } catch (error) {
    return { error: words(error), done: false };
  }
}
