import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { getOrganizationIdentity, setOrganizationIdentity, type OrganizationIdentityInput } from '@/lib/domain/tenancy/identity';
import { contactGildopsSupport } from '@/lib/domain/platform/support-requests';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { publicProfile } from '@/lib/domain/tenancy/profile';

/**
 * A business's private identity, its location at founding, and asking GildOps for help — against
 * the real local database, because the claims are about RLS, constraints and one transaction.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function signUp(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, email };
}

const FULL: OrganizationIdentityInput = {
  legalName: 'Pneu3L Inc.', industry: 'Auto repair', countryCode: 'CA', region: 'QC', city: 'Montreal', postalCode: 'H2X 1Y4',
  addressLine1: '123 Rue Example', addressLine2: 'Suite 4', contactEmail: 'allo@pneu3l.test', contactPhone: '+1 514 555 0100', websiteUrl: 'pneu3l.test',
};

let owner: SupabaseClient;
let organizationId: string;
let outsider: SupabaseClient;
let otherOrganizationId: string;

describe('business identity', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    owner = (await signUp('identity-owner')).db;
    organizationId = await createOrganization(owner, {
      name: 'Identity Test Co', timezone: 'America/Toronto', currency: 'CAD',
      location: { countryCode: 'ca', region: 'QC', city: 'Montreal', postalCode: 'H2X 1Y4', industry: 'Auto repair' },
    });
    outsider = (await signUp('identity-outsider')).db;
    otherOrganizationId = await createOrganization(outsider, { name: 'Other Co', timezone: 'America/Vancouver' });
  });

  it('records the location given at founding, in the same transaction as the business', async () => {
    const identity = await getOrganizationIdentity(owner, organizationId);
    expect(identity).toMatchObject({ countryCode: 'CA', region: 'QC', city: 'Montreal', postalCode: 'H2X 1Y4', industry: 'Auto repair', legalName: null });
  });

  it('founds nothing when the stated location is refused', async () => {
    const { data: before } = await owner.from('memberships').select('organization_id');
    const { error } = await owner.rpc('create_organization', {
      p_name: 'Half Founded', p_role: 'Admin', p_capabilities: ['organization.manage'], p_display_name: 'Me', p_timezone: 'UTC',
      p_identity: { countryCode: 'not-a-country', city: 'Nowhere' },
    });
    expect(error).not.toBeNull();
    const { data: after } = await owner.from('memberships').select('organization_id');
    expect(after?.length).toBe(before?.length);
  });

  it('refuses an unknown country or a postal code that does not fit the country before any write', async () => {
    await expect(createOrganization(owner, { name: 'X', timezone: 'UTC', location: { countryCode: 'ZZ' } })).rejects.toMatchObject({ code: 'identity.country_invalid' });
    await expect(createOrganization(owner, { name: 'X', timezone: 'UTC', location: { countryCode: 'CA', postalCode: '12345' } })).rejects.toMatchObject({ code: 'identity.postal_invalid' });
  });

  it('saves and reads back the full profile, treating an emptied field as unset', async () => {
    await setOrganizationIdentity(owner, { organizationId, ...FULL });
    const saved = await getOrganizationIdentity(owner, organizationId);
    expect(saved).toMatchObject({ legalName: 'Pneu3L Inc.', addressLine1: '123 Rue Example', websiteUrl: 'https://pneu3l.test' });

    await setOrganizationIdentity(owner, { organizationId, ...FULL, legalName: '', addressLine2: '' });
    const cleared = await getOrganizationIdentity(owner, organizationId);
    expect(cleared.legalName).toBeNull();
    expect(cleared.addressLine2).toBeNull();
  });

  it('keeps the private address out of the public profile', async () => {
    const profile = await publicProfile(owner, { organizationId, fallbackName: 'Identity Test Co' });
    expect(profile.address).toBeNull();
    expect(JSON.stringify(profile)).not.toContain('123 Rue Example');
  });

  it('does not let another business read or write this identity', async () => {
    expect(await getOrganizationIdentity(outsider, organizationId)).toMatchObject({ city: null, addressLine1: null });
    await expect(setOrganizationIdentity(outsider, { organizationId, ...FULL, city: 'Hijacked' })).rejects.toMatchObject({ code: 'identity.forbidden' });
    expect((await getOrganizationIdentity(owner, organizationId)).city).toBe('Montreal');
  });

  it('does not let a member without organization.manage change it, though they can read it', async () => {
    const colleague = await signUp('identity-colleague');
    const roleId = await createRole(owner, { organizationId, name: 'Viewer', capabilities: ['customer.create'] });
    await addMember(owner, { organizationId, email: colleague.email, displayName: 'Colleague', roleId });
    await expect(setOrganizationIdentity(colleague.db, { organizationId, ...FULL, city: 'Changed' })).rejects.toMatchObject({ code: 'identity.forbidden' });
    expect((await getOrganizationIdentity(colleague.db, organizationId)).city).toBe('Montreal');
  });

  it('shows nothing to a session that is not a member of anything', async () => {
    const anonymous = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await anonymous.from('organization_identity').select('organization_id');
    expect(data ?? []).toEqual([]);
  });
});

describe('contacting GildOps Support', () => {
  it('records a request from a member against their business, readable by the requester only', async () => {
    const id = await contactGildopsSupport(owner, { organizationId, subject: 'Question', message: 'How do I connect my phone?', page: `/organizations/${organizationId}/comms` });
    const { data } = await owner.from('platform_support_requests').select('id, organization_id, page, status').eq('id', id);
    expect(data).toEqual([{ id, organization_id: organizationId, page: `/organizations/${organizationId}/comms`, status: 'open' }]);

    const { data: others } = await outsider.from('platform_support_requests').select('id');
    expect(others ?? []).toEqual([]);
  });

  it('refuses a request about a business the caller does not belong to', async () => {
    await expect(contactGildopsSupport(outsider, { organizationId, subject: 'Hi', message: 'Hello' })).rejects.toMatchObject({ code: 'support_request.forbidden' });
  });

  it('gives the requester no way to read other tables through it', async () => {
    const { data } = await outsider.from('platform_support_requests').select('*').eq('organization_id', otherOrganizationId);
    expect(data ?? []).toEqual([]);
  });

  it('refuses an empty subject or message without writing', async () => {
    await expect(contactGildopsSupport(owner, { organizationId, subject: ' ', message: 'x' })).rejects.toMatchObject({ code: 'support_request.subject_required' });
    await expect(contactGildopsSupport(owner, { organizationId, subject: 'x', message: ' ' })).rejects.toMatchObject({ code: 'support_request.message_required' });
  });
});
