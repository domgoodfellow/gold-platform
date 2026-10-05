-- I7 vacuity control. Hand-run, never applied by a migration.
--
-- A test that would pass with the constraint removed proves nothing. This snippet removes
-- `work_item_resource_assignments_resource_not_double_booked` — the guarantee that no resource is
-- occupied twice over the same instant — so the suite can be watched failing.
--
-- (Until `20261116000002` this replaced `work_items_resource_not_double_booked` with the shape
-- `tire-app-template` is quoted for in constraints.md, a null resource coalesced to one key. An
-- assignment always names a resource, so that shape cannot be written any more; the control is
-- now the constraint's absence.)
--
-- Run against a database rebuilt from scratch, because that lesson is also recorded: a control
-- applied to an already-populated table can fail to build and let the test pass for entirely the
-- wrong reason. And a database where the control has run holds double-booked rows, so the
-- constraint cannot be added back to it — rebuild afterwards.
--
--   pnpm db:reset
--   docker exec -i supabase_db_infra psql -U postgres -d postgres \
--     -f - < supabase/snippets/i7-vacuity-control.sql
--   pnpm --filter @gold/web exec vitest run tests/integration/database/work-item-resource-assignments.test.ts
--
-- Expected: the overlap, atomic-set, reschedule, release-status, buffer and concurrency cases fail.
-- Restore with `pnpm db:reset`.

alter table public.work_item_resource_assignments
  drop constraint work_item_resource_assignments_resource_not_double_booked;

-- The lock control, separately: without `for share` an assignment added while its job is being
-- scheduled can read the job's old, empty window and leave a scheduled job holding nothing. Replace
-- `app.set_assignment_occupies` with its body minus the `for share`, and the concurrency case
-- "an assignment added while its job is being scheduled still holds the new window" fails.
