import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveTeamView } from '@/features/team/team-views';

/**
 * The Team workspace recomposition: one collection page with three URL-backed sibling views
 * (Members, Invitations, Roles) and bounded Sheets for creation/editing, replacing the inline
 * Disclosure forms ("Add somebody", "Invite by email", "Add a role") that used to expand inside
 * the primary page.
 *
 * **Structural claims are a source scan**, for the reason `settings-configuration-center.test.ts`
 * already gives: these are facts about which component a server file renders, and this repository
 * runs no harness that mounts one. **Authorization stays real Postgres** — `roles.test.ts`,
 * `members.test.ts`, `invitations.test.ts` and `role-editing.test.ts` are untouched by this slice
 * and remain the authority on `role.manage`.
 */

const ROUTES = fileURLToPath(new URL('../../../app/organizations/[organizationId]/roles', import.meta.url));
const FEATURES = fileURLToPath(new URL('../../../features/team', import.meta.url));

describe('Team views are URL-backed', () => {
  it('absent or invalid resolves to Members; the other two resolve exactly', () => {
    expect(resolveTeamView(undefined)).toBe('members');
    expect(resolveTeamView('')).toBe('members');
    expect(resolveTeamView('members')).toBe('members');
    expect(resolveTeamView('invitations')).toBe('invitations');
    expect(resolveTeamView('roles')).toBe('roles');
    expect(resolveTeamView('nonsense')).toBe('members');
  });
});

describe('Members is a collection, not an inline creation form', () => {
  const page = readFileSync(`${ROUTES}/page.tsx`, 'utf8');
  const membersTable = readFileSync(`${FEATURES}/members-table.tsx`, 'utf8');

  it('renders the members collection and keeps role assignment reachable inline', () => {
    expect(page).toContain('MembersTable');
    expect(membersTable).toContain('RoleAssignmentControl');
  });

  it('has no inline Disclosure form for adding a member', () => {
    expect(page).not.toContain('Disclosure');
    expect(page).not.toContain('AddMemberForm');
  });
});

describe('one Add Member Sheet exposes both existing operations', () => {
  const sheet = readFileSync(`${FEATURES}/add-member-sheet.tsx`, 'utf8');

  it('hosts both invite-by-email and add-existing-account, defaulting to invite', () => {
    expect(sheet).toContain('InviteMemberForm');
    expect(sheet).toContain('AddMemberForm');
    expect(sheet).toContain("useState<Mode>('invite')");
  });

  it('reuses the existing invite and add-member server actions rather than a new write API', () => {
    const actions = readFileSync(`${ROUTES}/actions.ts`, 'utf8');
    expect(actions).toContain('inviteMember(db');
    expect(actions).toContain('addMember(db');
  });

  it('keeps the copyable invitation link visible after a successful invite', () => {
    const inviteForm = readFileSync(`${FEATURES}/invite-member-form.tsx`, 'utf8');
    expect(inviteForm).toContain('state.link');
    expect(inviteForm).toContain('Copy');
  });

  it('is one Sheet, reused rather than duplicated, and reachable from both Members and Invitations', () => {
    expect(sheet.match(/function AddMemberSheetProvider/g)?.length).toBe(1);
    const page = readFileSync(`${ROUTES}/page.tsx`, 'utf8');
    // One trigger, in the page header, serving both views that add a person; Roles has its own.
    expect(page.match(/<AddMemberTrigger/g)?.length).toBe(1);
    expect(page).toContain("view === 'roles' ? <CreateRoleSheet organizationId={organizationId} /> : <AddMemberTrigger />");
  });
});

describe('Invitations is a collection with confirmed revocation', () => {
  const invitationsTable = readFileSync(`${FEATURES}/invitations-table.tsx`, 'utf8');
  const revokeDialog = readFileSync(`${FEATURES}/revoke-invitation-dialog.tsx`, 'utf8');

  it('renders pending invitations as a table', () => {
    expect(invitationsTable).toContain('DataTable');
  });

  it('revokes through the shared destructive confirmation, reusing the existing revoke action', () => {
    expect(revokeDialog).toContain('ConfirmSubmit');
    expect(revokeDialog).toContain('revokeInvitationAction');
  });
});

describe('Roles is a compact collection, not a capability-form page', () => {
  const rolesTable = readFileSync(`${FEATURES}/roles-table.tsx`, 'utf8');
  const createSheet = readFileSync(`${FEATURES}/create-role-sheet.tsx`, 'utf8');
  const editSheet = readFileSync(`${FEATURES}/edit-role-sheet.tsx`, 'utf8');
  const editorFields = readFileSync(`${FEATURES}/role-editor-fields.tsx`, 'utf8');

  it('summarizes permission count rather than rendering every capability as a badge', () => {
    expect(rolesTable).not.toContain('Badge');
    expect(rolesTable).toContain('permissionSummary');
  });

  it('New role opens a Sheet and Edit continues to use a Sheet, both sharing CapabilitySelector', () => {
    expect(createSheet).toContain('Sheet');
    expect(editSheet).toContain('Sheet');
    expect(editorFields).toContain('CapabilitySelector');
    expect(createSheet).toContain('RoleEditorFields');
    expect(editSheet).toContain('RoleEditorFields');
  });

  it('creates no second capability vocabulary or checkbox implementation', () => {
    expect(createSheet).not.toContain('type="checkbox"');
    expect(editSheet).not.toContain('type="checkbox"');
  });
});

describe('Settings compatibility is preserved', () => {
  it('/settings/people still redirects to /roles, and Settings is not the canonical Team owner', () => {
    const redirectPage = fileURLToPath(
      new URL('../../../app/organizations/[organizationId]/settings/people/page.tsx', import.meta.url),
    );
    const page = readFileSync(redirectPage, 'utf8');
    expect(page).toContain('redirect(');
    expect(page).toContain('/roles');

    const settings = readFileSync(
      fileURLToPath(new URL('../../../app/organizations/[organizationId]/settings/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(settings).not.toContain('/roles');
  });
});
