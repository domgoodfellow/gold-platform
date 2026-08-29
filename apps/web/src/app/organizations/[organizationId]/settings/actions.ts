'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { disconnectPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import {
  addOperatingHours,
  removeOperatingHours,
} from '@/lib/domain/scheduling/operating-hours';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { setPublicProfile } from '@/lib/domain/tenancy/profile';

export type SettingsActionState = { error: string | null };

export async function updateOrganizationAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await updateOrganization(db, {
      id: organizationId,
      name: String(formData.get('name') ?? ''),
      timezone: String(formData.get('timezone') ?? ''),
      currency: String(formData.get('currency') ?? ''),
      bufferMinutes: Number(formData.get('bufferMinutes') ?? Number.NaN),
      slug: String(formData.get('slug') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}

export async function addOperatingHoursAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // The day arrives as a number. Nothing in the platform holds a word for a day, in any
    // language — rendering one is this screen's problem and the reader's locale's business.
    await addOperatingHours(db, {
      organizationId,
      dayOfWeek: Number(formData.get('dayOfWeek') ?? Number.NaN),
      opensAt: String(formData.get('opensAt') ?? ''),
      closesAt: String(formData.get('closesAt') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}

export async function removeOperatingHoursAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await removeOperatingHours(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}

/**
 * What this business says about itself on its public page.
 *
 * Separate from the settings action above because they are separate claims: the clock a
 * business thinks in is a fact the platform needs to operate it, and a tagline is something it
 * tells strangers. Saving one should not require re-submitting the other.
 */
export async function updateProfileAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await setPublicProfile(db, {
      organizationId,
      displayName: String(formData.get('displayName') ?? ''),
      tagline: String(formData.get('tagline') ?? ''),
      intro: String(formData.get('intro') ?? ''),
      contactEmail: String(formData.get('contactEmail') ?? ''),
      contactPhone: String(formData.get('contactPhone') ?? ''),
      address: String(formData.get('address') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}

/**
 * Switch a module on or off.
 *
 * `revalidatePath` on the layout rather than the page, because what changes is the navigation
 * — the areas this business sees are read in `layout.tsx`, and revalidating only this screen
 * would leave the sidebar showing a module the business has just turned off.
 */
export async function setModuleEnabledAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await setModuleEnabled(db, {
      organizationId,
      key: String(formData.get('moduleKey') ?? ''),
      enabled: formData.get('enabled') === '1',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}`, 'layout');
  return { error: null };
}

/**
 * Stop using a connected processor account.
 *
 * There is no matching "connect" action: connecting is a redirect out to the provider and back
 * (`payments/connect`), because an account id is not something an operator can type. A form
 * that accepted one would let somebody point this business's payments at an account of their
 * choosing.
 */
export async function disconnectPaymentAccountAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await disconnectPaymentAccount(db, {
      organizationId,
      provider: String(formData.get('provider') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}
