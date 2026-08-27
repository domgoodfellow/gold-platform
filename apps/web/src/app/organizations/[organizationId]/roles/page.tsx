import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { CAPABILITY_LABELS } from '@/lib/domain/tenancy/capabilities';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { AddMemberForm } from './add-member-form';
import { CreateRoleForm } from './create-role-form';

export const dynamic = 'force-dynamic';

export default async function RolesPage({
  params,
}: PageProps<'/organizations/[organizationId]/roles'>) {
  const { organizationId } = await params;
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/sign-in');
    }
    throw error;
  }

  const organization = await getOrganization(db, organizationId);
  if (!organization) {
    notFound();
  }

  const [roles, members] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
  ]);
  const mayManage = organization.capabilities.includes('role.manage');

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">People and roles</h1>
      <p className="text-sm opacity-70">{organization.name}</p>

      <section className="mt-8">
        <h2 className="text-sm font-medium">People</h2>
        <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
          {members.map((member) => (
            <li key={member.id} className="flex items-baseline justify-between py-3">
              {/* The name this organization gave them. There is no email and no account
                  detail, because nothing here mirrors auth.users (D19). */}
              <span className="font-medium">{member.displayName}</span>
              <span className="text-sm opacity-70">{member.role.name}</span>
            </li>
          ))}
        </ul>

        {mayManage ? (
          <AddMemberForm organizationId={organizationId} roles={roles} />
        ) : (
          <p className="mt-4 text-sm opacity-70">
            Your role, {organization.role}, cannot add people here.
          </p>
        )}
      </section>

      <h2 className="mt-10 text-sm font-medium">Roles</h2>
      <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
        {roles.map((role) => (
          <li key={role.id} className="py-3">
            <div className="font-medium">{role.name}</div>
            <div className="text-sm opacity-70">
              {role.capabilities.length === 0
                ? 'Nothing yet'
                : role.capabilities.map((c) => CAPABILITY_LABELS[c]).join(' · ')}
            </div>
          </li>
        ))}
      </ul>

      {/*
        Hiding the form is a courtesy, not the guard. `roles_insert` requires role.manage in
        the database, so a caller who reaches the action anyway is refused there
        (constraints.md: hiding a UI element is not authorization).
      */}
      {mayManage ? (
        <CreateRoleForm organizationId={organizationId} />
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot manage roles here.
        </p>
      )}
    </main>
  );
}
