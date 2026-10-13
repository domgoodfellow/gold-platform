'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { disconnectPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import {
  disableOrganizationFeature,
  enableOrganizationFeature,
} from '@/lib/domain/catalogue/organization-plans';
import { removeLogo, setBrand, uploadLogo } from '@/lib/domain/branding/brand';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { setOrganizationIdentity } from '@/lib/domain/tenancy/identity';
import { setPublicProfile } from '@/lib/domain/tenancy/profile';
import { invalidateGoldHomepageIfReferenced } from '@/lib/domain/public-site/cached';
import { requireOrganization } from '@/lib/route/organization';

export type SettingsActionState = { error: string | null };

export async function updateOrganizationGeneralAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const { organization } = await requireOrganization(organizationId);

  try {
    await updateOrganization(db, {
      id: organizationId,
      name: String(formData.get('name') ?? ''),
      timezone: String(formData.get('timezone') ?? ''),
      // Empty only while the business has not chosen one; the form stops offering "decide later" once it has.
      currency: String(formData.get('currency') ?? '') || organization.currency,
      bufferMinutes: organization.bufferMinutes,
      slug: organization.slug,
    });
    await setOrganizationIdentity(db, {
      organizationId,
      legalName: String(formData.get('legalName') ?? ''),
      industry: String(formData.get('industry') ?? ''),
      countryCode: String(formData.get('countryCode') ?? ''),
      region: String(formData.get('region') ?? ''),
      city: String(formData.get('city') ?? ''),
      postalCode: String(formData.get('postalCode') ?? ''),
      addressLine1: String(formData.get('addressLine1') ?? ''),
      addressLine2: String(formData.get('addressLine2') ?? ''),
      contactEmail: String(formData.get('contactEmail') ?? ''),
      contactPhone: String(formData.get('contactPhone') ?? ''),
      websiteUrl: String(formData.get('websiteUrl') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // 'layout', not the page alone: the organization's name is read by the sidebar identity, the
  // context switcher and every breadcrumb in this shell, none of which sit under this route.
  revalidatePath(`/organizations/${organizationId}`, 'layout');
  await invalidateGoldHomepageIfReferenced(db, organizationId);
  return { error: null };
}

export async function updatePublicBookingAddressAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const { organization } = await requireOrganization(organizationId);
  const slug = String(formData.get('slug') ?? '');

  try {
    await updateOrganization(db, {
      id: organizationId,
      name: organization.name,
      timezone: organization.timezone,
      currency: organization.currency,
      bufferMinutes: organization.bufferMinutes,
      slug,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/domains`);
  if (organization.slug) revalidatePath(`/book/${organization.slug}`);
  const normalizedSlug = slug.trim().toLowerCase();
  if (normalizedSlug) revalidatePath(`/book/${normalizedSlug}`);
  await invalidateGoldHomepageIfReferenced(db, organizationId);
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
  await requireOrganization(organizationId);

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
  await invalidateGoldHomepageIfReferenced(db, organizationId);
  return { error: null };
}

/**
 * Switch a canonical Feature's activation override — the opt-out axis (domain-model.md), never
 * entitlement itself. Revalidates the layout for the same reason `setModuleEnabledAction` does:
 * a disabled feature can remove an area from the sidebar.
 */
export async function setFeatureActivationAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const featureId = String(formData.get('featureId') ?? '');
  const enabled = formData.get('enabled') === '1';

  try {
    if (enabled) {
      await enableOrganizationFeature(db, { organizationId, featureId });
    } else {
      await disableOrganizationFeature(db, { organizationId, featureId });
    }
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
  await requireOrganization(organizationId);

  try {
    await disconnectPaymentAccount(db, {
      organizationId,
      provider: String(formData.get('provider') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/finance/configuration/pricing`);
  return { error: null };
}

export type BrandState = { error: string | null; saved?: boolean };

/**
 * Choose a colour and a pair of lettering choices.
 *
 * **Revalidates the layout, not the page.** A brand is rendered by the shell — the roles come
 * from `BrandStyle` in `layout.tsx` — so revalidating only this screen would save a colour and
 * show the old one everywhere including the form that just saved it.
 */
export async function updateBrandAction(
  _previous: BrandState,
  formData: FormData,
): Promise<BrandState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await setBrand(db, {
      organizationId,
      accent: String(formData.get('accent') ?? ''),
      headingFont: String(formData.get('headingFont') ?? ''),
      bodyFont: String(formData.get('bodyFont') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}`, 'layout');
  await invalidateGoldHomepageIfReferenced(db, organizationId);
  return { error: null, saved: true };
}

export async function uploadLogoAction(
  _previous: BrandState,
  formData: FormData,
): Promise<BrandState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const file = formData.get('logo');

  if (!(file instanceof File)) {
    return { error: 'Choose an image to upload.' };
  }

  try {
    await uploadLogo(db, { organizationId, file });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}`, 'layout');
  await invalidateGoldHomepageIfReferenced(db, organizationId);
  return { error: null };
}

export async function removeLogoAction(
  _previous: BrandState,
  formData: FormData,
): Promise<BrandState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await removeLogo(db, { organizationId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}`, 'layout');
  await invalidateGoldHomepageIfReferenced(db, organizationId);
  return { error: null };
}
