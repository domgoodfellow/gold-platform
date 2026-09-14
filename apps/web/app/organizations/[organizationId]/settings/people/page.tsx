import { Badge } from '@/components/display/data';
import { Disclosure } from '@/components/containers/card';
import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { CAPABILITY_LABELS } from '@/lib/domain/tenancy/capabilities';
import { listPendingInvitations } from '@/lib/domain/tenancy/invitations';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';
import { AddMemberForm } from '../../roles/add-member-form';
import { CreateRoleForm } from '../../roles/create-role-form';
import { EditRoleSheet } from '../../roles/edit-role-sheet';
import { InviteMemberForm } from '../../roles/invite-member-form';
import { PendingInvitations } from '../../roles/pending-invitations';
import { RoleAssignmentControl } from '../../roles/role-assignment-control';

export const dynamic = 'force-dynamic';

/**
 * "Who can access this business and what can they do?" — Members, Invitations and Roles &
 * permissions were three independent settings pages that all answered this one question; this
 * is that one question, asked once, with three tabs rather than three destinations.
 *
 * Every form here is the same component `/roles` always used (moved from a top-level area under
 * Slice 3, kept as-is here) — this is a relocation, not a rewrite. `/roles` now redirects here.
 */
export default async function PeopleSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/people'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [roles, members, invitations] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
    listPendingInvitations(db, { organizationId }),
  ]);
  const mayManage = organization.capabilities.includes('role.manage');

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>People &amp; access</PageHeading>
      <Hint className="mt-1">Who works here, and what each role may do.</Hint>

      <Tabs defaultValue="members" className="mt-6">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">
            Invitations{invitations.length > 0 ? ` (${invitations.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          {mayManage ? (
            <Disclosure summary="Add somebody" defaultOpen={members.length <= 1}>
              <AddMemberForm organizationId={organizationId} roles={roles} />
            </Disclosure>
          ) : (
            <Hint className="mt-2">Your role, {organization.role}, cannot add people here.</Hint>
          )}

          <div className="mt-4">
            <DataTable
              rows={members}
              rowKey={(member) => member.id}
              empty="Nobody here yet."
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  emphasis: 'primary',
                  cell: (member) => member.displayName,
                },
                {
                  key: 'role',
                  header: 'Role',
                  cell: (member) =>
                    mayManage ? (
                      <RoleAssignmentControl
                        organizationId={organizationId}
                        membershipId={member.id}
                        currentRoleId={member.role.id}
                        roles={roles}
                      />
                    ) : (
                      <Badge>{member.role.name}</Badge>
                    ),
                },
              ]}
            />
          </div>
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          {mayManage ? (
            <Disclosure summary="Invite by email" defaultOpen={invitations.length === 0}>
              <InviteMemberForm organizationId={organizationId} roles={roles} />
            </Disclosure>
          ) : (
            <Hint className="mt-2">Your role, {organization.role}, cannot invite people here.</Hint>
          )}

          <div className="mt-4">
            {invitations.length > 0 ? (
              <PendingInvitations organizationId={organizationId} invitations={invitations} />
            ) : (
              <Hint>No pending invitations.</Hint>
            )}
          </div>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          {mayManage ? (
            <Disclosure summary="Add a role">
              <CreateRoleForm organizationId={organizationId} />
            </Disclosure>
          ) : (
            <Hint className="mt-2">Your role, {organization.role}, cannot manage roles here.</Hint>
          )}

          <div className="mt-4">
            <DataTable
              rows={roles}
              rowKey={(role) => role.id}
              empty="No roles yet."
              columns={[
                { key: 'name', header: 'Role', emphasis: 'primary', cell: (role) => role.name },
                {
                  key: 'capabilities',
                  header: 'May do',
                  cell: (role) =>
                    role.capabilities.length === 0 ? (
                      <span className="text-subtle">Nothing yet</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {role.capabilities.map((capability) => (
                          <Badge key={capability}>{CAPABILITY_LABELS[capability]}</Badge>
                        ))}
                      </div>
                    ),
                },
                ...(mayManage
                  ? [
                      {
                        key: 'edit',
                        header: '',
                        cell: (role: (typeof roles)[number]) => (
                          <EditRoleSheet organizationId={organizationId} role={role} />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </TabsContent>
      </Tabs>
    </SettingsPageFrame>
  );
}
