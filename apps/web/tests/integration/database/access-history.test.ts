import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { listAccessChanges } from '@/lib/domain/tenancy/access-history';
import { setOrganizationIdentity } from '@/lib/domain/tenancy/identity';
import { inviteMember, listPendingInvitations, revokeInvitation } from '@/lib/domain/tenancy/invitations';
import { addMember } from '@/lib/domain/tenancy/members';
import { listRoleSuggestions } from '@/lib/domain/tenancy/role-suggestions';
import { assignRole, createRole, deleteRole, listRoles, updateRoleCapabilities } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Access history reads the events the access functions already write, in plain sentences and for
 * this business only. Role suggestions come from the published industry templates that match the
 * business, and from nowhere else.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Actor = { db: SupabaseClient; userId: string; email: string };

async function signUp(label: string): Promise<Actor> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.user.id, email };
}

const IDENTITY = { legalName: '', countryCode: '', region: '', city: '', postalCode: '', addressLine1: '', addressLine2: '', contactEmail: '', contactPhone: '', websiteUrl: '' };

let owner: Actor;
let organizationId: string;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  owner = await signUp('history-owner');
  organizationId = await foundBusiness({ ownerEmail: owner.email, name: `History ${randomUUID().slice(0, 6)}`, displayName: 'Founder', currency: 'EUR' });
});

describe('access history', () => {
  it('says who changed what, newest first, in sentences rather than codes', async () => {
    const dispatcher = await createRole(owner.db, { organizationId, name: 'Dispatcher', capabilities: ['customer.create'] });
    await updateRoleCapabilities(owner.db, { roleId: dispatcher, name: 'Dispatcher', capabilities: ['customer.create', 'customer.update'] });
    const colleague = await signUp('history-colleague');
    const membershipId = await addMember(owner.db, { organizationId, email: colleague.email, displayName: 'Colleague', roleId: dispatcher });
    const admin = (await listRoles(owner.db, { organizationId })).find((role) => role.name === 'Admin')!.id;
    await assignRole(owner.db, { membershipId, roleId: admin });
    const invited = `invited-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(owner.db, { organizationId, email: invited, roleId: dispatcher });
    await revokeInvitation(owner.db, { id: (await listPendingInvitations(owner.db, { organizationId })).find((invitation) => invitation.email === invited)!.id });
    await deleteRole(owner.db, { roleId: dispatcher });

    const changes = await listAccessChanges(owner.db, { organizationId });
    const summaries = changes.map((change) => change.summary);
    expect(summaries.slice(0, 7)).toEqual([
      'Deleted the role Dispatcher',
      `Revoked the invitation to ${invited}`,
      `Invited ${invited} as a role that has since been deleted`,
      'Changed Colleague to Admin',
      'Added Colleague as a role that has since been deleted',
      'Changed the role Dispatcher, which now has 2 permissions',
      'Created the role Dispatcher with 1 permission',
    ]);
    expect(new Set(changes.slice(0, 7).map((change) => change.actor))).toEqual(new Set(['Founder']));
    for (const summary of summaries) expect(summary).not.toMatch(/\b(role|membership|organization)\.[a-z_]+|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('shows another business nothing of this one', async () => {
    const stranger = await signUp('history-stranger');
    await foundBusiness({ ownerEmail: stranger.email, name: `Elsewhere ${randomUUID().slice(0, 6)}`, displayName: 'Stranger', currency: 'EUR' });
    expect(await listAccessChanges(stranger.db, { organizationId })).toEqual([]);
  });

  it('pages through older changes without repeating or omitting a row', async () => {
    const changes = await listAccessChanges(owner.db, { organizationId });
    const first = await listAccessChanges(owner.db, { organizationId, limit: 3 });
    const next = await listAccessChanges(owner.db, { organizationId, offset: 3, limit: 3 });
    expect([...first, ...next].map((row) => row.id)).toEqual(changes.slice(0, 6).map((row) => row.id));
  });
});

describe('role suggestions', () => {
  it('offers none to a business with no matching template', async () => {
    expect(await listRoleSuggestions(owner.db, { organizationId, existingRoleNames: ['Admin'] })).toEqual([]);
  });

  it('offers the roles of the published template for the industry the business gave, skipping names it already has', async () => {
    await setOrganizationIdentity(owner.db, { organizationId, ...IDENTITY, industry: 'Professional services' });
    const { data: template } = await owner.db.from('industry_templates').select('name, shape').eq('key', 'answering_service').single();
    const expected = (template!.shape as { roles: { name: string; capabilities: string[] }[] }).roles;

    const suggestions = await listRoleSuggestions(owner.db, { organizationId, existingRoleNames: ['Admin'] });
    expect(suggestions.map((suggestion) => suggestion.name)).toEqual(expected.map((role) => role.name));
    expect(suggestions[0].from).toBe(template!.name);
    expect(suggestions[0].capabilities).toEqual(expected[0].capabilities);

    const fewer = await listRoleSuggestions(owner.db, { organizationId, existingRoleNames: ['Admin', expected[0].name.toUpperCase()] });
    expect(fewer.map((suggestion) => suggestion.name)).toEqual(expected.slice(1).map((role) => role.name));
  });

  it('also matches a published template by its business type name', async () => {
    const { data: template, error } = await owner.db.from('industry_templates').select('name').eq('key', 'answering_service').single();
    if (error) throw error;
    await setOrganizationIdentity(owner.db, { organizationId, ...IDENTITY, industry: ` ${template.name.toUpperCase()} ` });
    expect((await listRoleSuggestions(owner.db, { organizationId, existingRoleNames: [] })).every((suggestion) => suggestion.from === template.name)).toBe(true);
    expect((await listRoleSuggestions(owner.db, { organizationId, existingRoleNames: [] })).length).toBeGreaterThan(0);
  });
});
