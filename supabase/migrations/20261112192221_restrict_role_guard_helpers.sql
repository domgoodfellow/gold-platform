-- Trigger functions are internal entry points, executed by their table triggers only.
revoke all on function app.check_role_grant() from public, anon, authenticated;
revoke all on function app.check_role_assignment_grant() from public, anon, authenticated;
