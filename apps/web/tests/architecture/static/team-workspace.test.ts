import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveTeamView } from '@/features/team/team-views';

/**
 * Access: four URL-backed Settings destinations, including read-only history. Adding
 * a person is a focused dialog; a role is created, edited and deleted on its own page, because 41
 * permissions and their consequences do not fit a drawer.
 *
 * **Structural claims are a source scan**, for the reason `settings-configuration-center.test.ts`
 * already gives: these are facts about which component a server file renders, and this repository
 * runs no harness that mounts one. **Authorization stays real Postgres** — `roles.test.ts`,
 * `members.test.ts`, `invitations.test.ts` and `role-editing.test.ts` are untouched by this slice
 * and remain the authority on `role.manage`.
 */

const ROUTES = fileURLToPath(new URL('../../../app/organizations/[organizationId]/settings/access', import.meta.url));
const FEATURES = fileURLToPath(new URL('../../../features/team', import.meta.url));

describe('Team views are URL-backed', () => {
  it('absent or invalid resolves to Members; other destinations resolve exactly', () => {
    expect(resolveTeamView(undefined)).toBe('members');
    expect(resolveTeamView('')).toBe('members');
    expect(resolveTeamView('members')).toBe('members');
    expect(resolveTeamView('invitations')).toBe('invitations');
    expect(resolveTeamView('roles')).toBe('roles');
    expect(resolveTeamView('history')).toBe('history');
    expect(resolveTeamView('nonsense')).toBe('members');
  });
});

describe('Members is a collection, not an inline creation form', () => {
  const page = readFileSync(`${ROUTES}/access-page.tsx`, 'utf8');
  const membersTable = readFileSync(`${FEATURES}/members-table.tsx`, 'utf8');

  it('renders the members collection and keeps role assignment reachable inline', () => {
    expect(page).toContain('MembersTable');
    expect(membersTable).toContain('RoleAssignmentControl');
  });

  it('changes a role only from a confirmation, never the moment a choice is made', () => {
    const control = readFileSync(`${FEATURES}/role-assignment-control.tsx`, 'utf8');
    expect(control).toContain('ConfirmSubmit');
    expect(control).not.toContain('submitOnChange');
  });

  it('has no inline Disclosure form for adding a member', () => {
    expect(page).not.toContain('Disclosure');
    expect(page).not.toContain('AddMemberForm');
  });
});

// Batch B: adding somebody is an address and a role, so it is a focused dialog, not a drawer.
describe('one Add member dialog exposes both existing operations', () => {
  const sheet = readFileSync(`${FEATURES}/add-member-dialog.tsx`, 'utf8');

  it('is the shared Dialog, not a PageDrawer', () => {
    expect(sheet).toContain("from '@/components/controls/confirm-submit'");
    expect(sheet).not.toContain('PageDrawer');
  });

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

  it('is one dialog, reused rather than duplicated, and reachable from both Members and Invitations', () => {
    expect(sheet.match(/function AddMemberDialogProvider/g)?.length).toBe(1);
    const page = readFileSync(`${ROUTES}/access-page.tsx`, 'utf8');
    // One trigger, in the page header, serving both views that add a person; Roles has its own.
    expect(page.match(/<AddMemberTrigger/g)?.length).toBe(1);
    expect(page).toMatch(/view === 'roles' \? <ButtonLink[^>]*\/new`\}>/);
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

describe('Roles is a compact collection, and a role is edited on its own page', () => {
  const rolesTable = readFileSync(`${FEATURES}/roles-table.tsx`, 'utf8');
  const editor = readFileSync(`${FEATURES}/role-editor.tsx`, 'utf8');
  const editorFields = readFileSync(`${FEATURES}/role-editor-fields.tsx`, 'utf8');

  it('summarizes permission count rather than rendering every capability as a badge', () => {
    expect(rolesTable).not.toContain('Badge');
    expect(rolesTable).toContain('permissionSummary');
  });

  it('New role and an existing role are the same full-page editor, sharing CapabilitySelector', () => {
    for (const route of ['roles/new/page.tsx', 'roles/[roleId]/page.tsx']) expect(readFileSync(`${ROUTES}/${route}`, 'utf8')).toContain('<RoleEditor');
    expect(editor).toContain('RoleEditorFields');
    expect(editorFields).toContain('CapabilitySelector');
    expect(`${editor}${editorFields}`).not.toMatch(/PageDrawer|Sheet/);
    for (const retired of ['create-role-sheet.tsx', 'edit-role-sheet.tsx']) expect(() => readFileSync(`${FEATURES}/${retired}`, 'utf8')).toThrow();
  });

  it('creates no second capability vocabulary or checkbox implementation', () => {
    expect(editor).not.toContain('type="checkbox"');
    expect(editorFields).not.toContain('type="checkbox"');
  });

  it('protects unsaved work, confirms a save, and deletes only through a confirmation', () => {
    expect(editor).toContain('useUnsavedChanges');
    expect(editor).toContain("toast.success('Role saved')");
    expect(editor).toContain('ConfirmSubmit');
    expect(editor).toContain('deleteRoleAction');
  });
});

describe('Settings compatibility is preserved', () => {
  it('/settings/people still redirects to /roles, and Settings is not the canonical Team owner', () => {
    const redirectPage = fileURLToPath(
      new URL('../../../app/organizations/[organizationId]/settings/people/page.tsx', import.meta.url),
    );
    const page = readFileSync(redirectPage, 'utf8');
    expect(page).toContain('redirect(');
    expect(page).toContain('/settings/access');

    const settings = readFileSync(
      fileURLToPath(new URL('../../../app/organizations/[organizationId]/settings/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(settings).not.toContain('/roles');
  });
});
