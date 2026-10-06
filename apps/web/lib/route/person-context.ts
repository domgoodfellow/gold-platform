import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { listMyOrganizations, type Organization } from '@/lib/domain/tenancy/organizations';

/**
 * What is safe to know about the signed-in person without any one organization: who they are and
 * which businesses and scopes are genuinely theirs. It is the only input the shells that stand
 * outside a business (Personal settings, the fallback frame) render from — none of it is read
 * from a URL, so none of it can be made to describe somebody else's organization.
 *
 * Every caller runs this itself rather than trusting a layout (I12).
 */
export type PersonContext = {
  email: string;
  hasPassword: boolean;
  displayName: string;
  pendingEmail: string | null;
  signInMethods: string[];
  organizations: Organization[];
  staff: boolean;
  goldInternal: { id: string } | null;
};

export async function loadPersonContext(): Promise<PersonContext> {
  const db = await getDb();

  let email: string;
  let hasPassword: boolean;
  let displayName: string;
  let pendingEmail: string | null;
  let signInMethods: string[];
  try {
    await requireActor(db);
    const { data } = await db.auth.getUser();
    email = data.user?.email ?? '';
    displayName = typeof data.user?.user_metadata.display_name === 'string' ? data.user.user_metadata.display_name : '';
    pendingEmail = data.user?.new_email || null;
    signInMethods = [...new Set((data.user?.identities ?? []).map((identity) => identity.provider))];
    // Supabase records how somebody actually signed in as a list of identities. A Google-only
    // account has no password to change, and offering the form anyway would be a control with
    // nothing behind it (D31's reasoning, restated for auth rather than a module switch).
    hasPassword = (data.user?.identities ?? []).some((identity) => identity.provider === 'email');
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/login');
    }
    throw error;
  }

  const organizations = await listMyOrganizations(db);
  const [staff, goldInternal] = await Promise.all([isPlatformStaff(db), findGoldInternalOrganization(db, organizations)]);

  return {
    email,
    hasPassword,
    displayName,
    pendingEmail,
    signInMethods,
    organizations,
    staff,
    goldInternal,
  };
}
