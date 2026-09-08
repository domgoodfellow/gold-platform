-- I7 vacuity control. Hand-run, never applied by a migration.
--
-- A test that would pass with the constraint removed proves nothing. This snippet replaces
-- `work_items_resource_not_double_booked` with the shape constraints.md quotes from
-- `tire-app-template` by name, so the suite can be watched failing:
--
--   > `tire-app-template` has an exclusion constraint that coalesces a null technician to the
--   > zero UUID, so every unassigned booking in the database shares one exclusion key. Add a
--   > second tenant and their unassigned 9am job blocks yours, as a bare `23P01` with no
--   > obvious cause.
--
-- Run against a database rebuilt from scratch, because that lesson is also recorded: M1's
-- first control attempt applied a global unique index to an already-populated table, the
-- index failed to build, and the test passed for entirely the wrong reason.
--
--   pnpm db:reset
--   docker exec -i supabase_db_infra psql -U postgres -d postgres \
--     -f - < infra/supabase/snippets/i7-vacuity-control.sql
--   pnpm --filter @gold/web test -- scheduling milestone-m2
--
-- Expected: "does not let one tenant's unassigned work block another tenant's" fails with
-- 23P01. Restore with `pnpm db:reset`.

alter table public.work_items
  drop constraint work_items_resource_not_double_booked;

-- The wrong shape, deliberately: no leading organization_id, and a coalesced null resource
-- so that every unassigned scheduled row in the database shares one key.
alter table public.work_items
  add constraint work_items_resource_not_double_booked
  exclude using gist (
    (coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    scheduled_during with &&
  );
