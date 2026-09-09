'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import type { BusinessShape } from '@/lib/domain/configuration/configure';
import {
  applyConfigurationProposal,
  currentConfigurationProposal,
  discardConfigurationProposal,
  proposeConfiguration,
  reviseConfigurationProposal,
} from '@/lib/domain/configuration/proposals';
import { launchOrganization } from '@/lib/domain/tenancy/lifecycle';

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
  return { error: null };
}

export async function proposeAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

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

    await reviseConfigurationProposal(db, { proposalId, shape });
  });
}

export async function applyAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, async () => {
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

    await applyConfigurationProposal(db, { organizationId, proposalId });
  });
}

export async function launchAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () => launchOrganization(db, { organizationId }));
}

export async function discardAction(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');

  return run(organizationId, () => discardConfigurationProposal(db, { proposalId }));
}
