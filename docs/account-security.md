# Account security configuration

The application keeps identity in Supabase Auth. No duplicate user table is introduced.
Personal `user_metadata.display_name` is cosmetic; organization names remain in memberships.
Authorization must never use user-editable metadata.

## Hosted Supabase release requirements

Apply these in Authentication → Sign In / Providers → Email before releasing Account changes:

- Minimum password length: 15; retain acceptance of long passphrases (at least 64 characters).
- Secure password change: enabled (old sessions must provide a reauthentication nonce).
- Require current password when updating: enabled. The application also verifies the current
  password using a separate public-key client, so local stacks and older Auth servers cannot
  silently skip the check. The authenticated update supplies `current_password` and `password`.
- Secure email change / double confirmation: enabled. Both old and new addresses must approve.
- Password changed and Email changed notifications: enabled.
- Magic link template: copy `supabase/templates/identity-verification.html` so the existing-address
  step-up message includes `{{ .Token }}`. The application verifies a fresh single-use email code
  in an isolated client, checks its user id against the authenticated actor, then proposes the
  new address. It never replaces the active session or its MFA assurance with the proof session.
- Add the deployed `/auth/email-change` callback to the Auth redirect allowlist. Confirmation
  returns to Account through a fixed relative redirect; query parameters cannot supply a destination.
- Enable leaked-password protection on hosted projects where the plan supports it.

`supabase/config.toml` sets local password length, secure password change, double confirmation,
notification flags and the code template. Hosted settings are not changed by editing this file.
The current-password native toggle is not exposed by all CLI versions; do not invent a TOML key.
Password verification creates and revokes a temporary local-scope session and does not revoke
other sessions. Recovery also requires a fresh signed Auth recovery/email-code claim; an ordinary
active password or OAuth session cannot use the reset action to bypass current-password proof.
Email codes are rate limited by Supabase; invalid or expired codes reject the
change before any update. Confirmation leaves the existing email authoritative until completed.

## Follow-up hardening slice

MFA enrollment and recovery, device/session listing and sign-out-other-sessions need a complete
sign-in challenge/recovery journey and server-side assurance enforcement for sensitive operations.
Do not present enrollment alone as MFA protection or invent session rows beside Auth's own sessions.
These are separate from the immediate Settings ownership and identity-change correction.

References: [password security](https://supabase.com/docs/guides/auth/password-security),
[updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser),
[security notification templates](https://supabase.com/blog/introducing-seven-new-email-templates-for-auth).
