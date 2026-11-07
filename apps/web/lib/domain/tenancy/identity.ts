import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isCountryCode, postalCodeValid } from '@/lib/domain/tenancy/regional-defaults';

/**
 * What a business is, privately: its legal name, industry, where it is and how it can be reached.
 * The business's operating name, time zone and currency stay on `organizations`; what it says to
 * strangers stays on `organization_profiles`. This is the third thing — a record only members can
 * read — and nothing here is published without the business doing so deliberately.
 */
/** Who a business serves. */
export const BUSINESS_SERVES = ['people', 'companies', 'both'] as const;
export type BusinessServes = (typeof BUSINESS_SERVES)[number];
export const isBusinessServes = (value: unknown): value is BusinessServes => (BUSINESS_SERVES as readonly unknown[]).includes(value);

export type OrganizationIdentity = {
  legalName: string | null;
  industry: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  /** Who it serves; null until it says. Written by `setBusinessServes`, not with the rest. */
  serves: BusinessServes | null;
};

export type OrganizationIdentityInput = { [K in Exclude<keyof OrganizationIdentity, 'serves'>]: string };

export const EMPTY_IDENTITY: OrganizationIdentity = {
  legalName: null, industry: null, countryCode: null, region: null, city: null, postalCode: null,
  addressLine1: null, addressLine2: null, contactEmail: null, contactPhone: null, websiteUrl: null, serves: null,
};

export async function getOrganizationIdentity(db: Db, organizationId: string): Promise<OrganizationIdentity> {
  const { data, error } = await db
    .from('organization_identity')
    .select('legal_name, industry, country_code, region, city, postal_code, address_line1, address_line2, contact_email, contact_phone, website_url, serves')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw new DomainError(error.message, 'identity.read_failed');
  if (!data) return EMPTY_IDENTITY;

  return {
    legalName: data.legal_name, industry: data.industry, countryCode: data.country_code, region: data.region,
    city: data.city, postalCode: data.postal_code, addressLine1: data.address_line1, addressLine2: data.address_line2,
    contactEmail: data.contact_email, contactPhone: data.contact_phone, websiteUrl: data.website_url,
    serves: isBusinessServes(data.serves) ? data.serves : null,
  };
}

/** Say who the business serves. `organization.manage`, enforced by the database policy. */
export async function setBusinessServes(db: Db, input: { organizationId: string; serves: BusinessServes }): Promise<void> {
  await requireActor(db);
  if (!isBusinessServes(input.serves)) {
    throw new DomainError('Choose people, companies or both.', 'identity.serves_invalid');
  }
  const { error } = await db.rpc('set_business_serves', { p_organization_id: input.organizationId, p_serves: input.serves });
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot change this business’s identity.', 'identity.forbidden');
    throw new DomainError(error.message, 'identity.update_failed');
  }
}

/** What a business still has to say about where it is. Only the location blocks being "complete"; legal name and the rest are optional by design. */
export function missingIdentity(identity: OrganizationIdentity): string[] {
  const missing: string[] = [];
  if (!identity.countryCode) missing.push('country');
  if (!identity.city) missing.push('city');
  if (!identity.industry) missing.push('industry');
  return missing;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A bare "example.com" is accepted and stored as https; anything that is not http(s) is refused. */
export function normaliseWebsite(value: string): string {
  const raw = value.trim();
  if (raw.length === 0) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new DomainError('That website address is not valid.', 'identity.website_invalid');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) {
    throw new DomainError('A website address starts with http:// or https:// and names a domain.', 'identity.website_invalid');
  }
  return url.toString().replace(/\/$/, '');
}

export function validateIdentity(input: OrganizationIdentityInput): OrganizationIdentityInput {
  const country = input.countryCode.trim().toUpperCase();
  if (country && !isCountryCode(country)) {
    throw new DomainError('Choose a country from the list.', 'identity.country_invalid');
  }
  if (input.postalCode.trim() && country && !postalCodeValid(country, input.postalCode)) {
    throw new DomainError('That postal code does not look right for the selected country.', 'identity.postal_invalid');
  }
  if (input.contactEmail.trim() && !EMAIL.test(input.contactEmail.trim())) {
    throw new DomainError('That is not a valid email address.', 'identity.email_invalid');
  }
  if (input.addressLine1.trim() && !(country && input.city.trim())) {
    throw new DomainError('A street address needs a country and a city.', 'identity.address_incomplete');
  }
  return { ...input, countryCode: country, websiteUrl: normaliseWebsite(input.websiteUrl) };
}

/** `organization.manage`, enforced by the database policy; this is the message, not the guard. */
export async function setOrganizationIdentity(
  db: Db,
  input: { organizationId: string } & OrganizationIdentityInput,
): Promise<void> {
  await requireActor(db);
  const clean = validateIdentity(input);

  const { error } = await db.rpc('set_organization_identity', {
    p_organization_id: input.organizationId,
    p_legal_name: clean.legalName,
    p_industry: clean.industry,
    p_country_code: clean.countryCode,
    p_region: clean.region,
    p_city: clean.city,
    p_postal_code: clean.postalCode,
    p_address_line1: clean.addressLine1,
    p_address_line2: clean.addressLine2,
    p_contact_email: clean.contactEmail,
    p_contact_phone: clean.contactPhone,
    p_website_url: clean.websiteUrl,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change this business’s identity.', 'identity.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError('One of those values is longer or shorter than this allows.', 'identity.invalid');
    }
    throw new DomainError(error.message, 'identity.update_failed');
  }
}
