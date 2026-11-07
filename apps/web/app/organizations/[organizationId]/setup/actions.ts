'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import type { BusinessShape } from '@/lib/domain/configuration/configure';
import {
  applyConfigurationProposal,
  currentConfigurationProposal,
  deferConfigurationProposal,
  discardConfigurationProposal,
  draftFromBusiness,
  draftFromTemplate,
  proposeConfiguration,
  reviseConfigurationProposal,
} from '@/lib/domain/configuration/proposals';
import { launchOrganization } from '@/lib/domain/tenancy/lifecycle';
import { organizationHomeHref } from '@/lib/navigation';
import { invalidateGoldHomepageIfReferenced } from '@/lib/domain/public-site/cached';
import { requireOrganization } from '@/lib/route/organization';
import { COPY_PREFIX } from '@/lib/domain/configuration/shape';

export type SetupActionState = { error: string | null };

/**
 * Four writes, one shape — the automations screen's `run`, for the same reason.
 *
 * Every one of these is a separate decision with its own failure, and every one of them can only
 * report what the domain layer said. Nothing here decides anything: a route is a caller.
 */
async function run(
  organizationId: string,
  write: () => Promise<unknown>,
): Promise<SetupActionState> {
  try {
    await write();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/setup`);
  revalidatePath(`/organizations/${organizationId}/setup/proposal`);
  return { error: null };
}

export async function proposeAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  return run(organizationId, async () => {
    // **A refinement carries the last proposal forward**, so answering a question keeps
    // everything already agreed to. Read here rather than posted from the browser: a shape is
    // the thing being decided, and a hidden field holding one is a shape a client could edit
    // without anybody reviewing the edit.
    const previous = await currentConfigurationProposal(db, { organizationId });

    await proposeConfiguration(db, {
      organizationId,
      description: String(formData.get('description') ?? ''),
      previous: formData.get('refine') === 'yes' ? previous : null,
    });
  });
}

/**
 * Save what a person edited the proposal into.
 *
 * **The form posts the whole shape as JSON, and this is the one place that is right.** Every
 * other form on this platform posts named fields, because every other form edits rows. This one
 * edits a document that is not configuration yet — statuses a business has not agreed to, prices
 * nothing is quoted at — and turning it into a hundred named fields would mean naming, on the
 * server, a structure whose whole point is that the domain layer owns its shape.
 *
 * What makes that safe is that nothing here is trusted: `configureBusiness` validates the shape
 * on the way out, and every write it then makes goes through a policy.
 */
export async function reviseAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const proposalId = String(formData.get('proposalId') ?? '');

  return run(organizationId, async () => {
    let shape: BusinessShape;
    try {
      shape = JSON.parse(String(formData.get('shape') ?? '')) as BusinessShape;
    } catch {
      throw new DomainError(
        'That setup could not be read back. Reload the page and try again.',
        'proposals.shape_unreadable',
      );
    }

    await reviseConfigurationProposal(db, { organizationId, proposalId, shape });
  });
}

export async function applyAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  let landOnSetup = false;
  let stopped: string | null = null;
  const result = await run(organizationId, async () => {
    // The id the page rendered, and nothing else about the proposal — the domain function reads
    // the row itself and decides whether it is still a draft, so a page open in another tab
    // cannot apply something that has already been applied.
    const proposalId = String(formData.get('proposalId') ?? '');
    if (!proposalId) {
      throw new DomainError(
        'There is no setup waiting to be applied.',
        'proposals.nothing_to_apply',
      );
    }

    const applied = await applyConfigurationProposal(db, { organizationId, proposalId });
    // A reviewed setup proposal may carry canonical profile or brand fields. Those are referenced
    // by the public projection rather than copied into a page revision.
    await invalidateGoldHomepageIfReferenced(db, organizationId);
    if (applied.outcome === 'failed') stopped = applied.detail;
    // A starting setup lands on Setup, whose steps show what is left.
    else landOnSetup = applied.origin !== 'drafted';
  });
  if (result.error) return result;
  // The same document is waiting again as a new draft; applying it finishes the rest.
  if (stopped !== null) return { error: `Setup stopped before it finished: ${stopped} Nothing is lost. Fix it here and apply again to finish.` };
  if (landOnSetup) {
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    redirect(`/organizations/${organizationId}/setup`);
  }
  return result;
}

/** Open a starting template as a draft to review, or start blank. Either way nothing is applied yet. */
export async function startAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const templateKey = String(formData.get('templateKey') ?? '');
  if (!templateKey) redirect(`/organizations/${organizationId}/setup`);

  // Another business of the same person's, copied as a draft; otherwise a starting template.
  const sourceOrganizationId = templateKey.startsWith(COPY_PREFIX) ? templateKey.slice(COPY_PREFIX.length) : null;
  const result = await run(organizationId, () => sourceOrganizationId
    ? draftFromBusiness(db, { organizationId, sourceOrganizationId })
    : draftFromTemplate(db, { organizationId, templateKey }));
  return result;
}

/** Not now: the draft stays waiting, reachable from Setup, and Setup opens. */
export async function deferAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const proposalId = String(formData.get('proposalId') ?? '');

  const result = await run(organizationId, () => deferConfigurationProposal(db, { organizationId, proposalId }));
  if (result.error) return result;
  redirect(`/organizations/${organizationId}/setup`);
}

export async function launchAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  const result = await run(organizationId, () => launchOrganization(db, { organizationId }));
  if (result.error) return result;

  // The shell's Setup treatment is read by the layout, so the layout is revalidated too — the
  // business is LIVE and must stop looking like it is onboarding on the very next screen.
  revalidatePath(`/organizations/${organizationId}`, 'layout');
  // Outside `run`'s try — `redirect` works by throwing.
  redirect(organizationHomeHref(organizationId, 'live'));
}

export async function discardAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const proposalId = String(formData.get('proposalId') ?? '');

  return run(organizationId, () => discardConfigurationProposal(db, { organizationId, proposalId }));
}
