-- A job cannot be created already scheduled, and the two mirrored columns leave the insert grant.
--
-- **Found by sweeping for the `external_actors` pattern rather than by hitting it**, which is
-- the whole reason that sweep was worth doing: `20260902000002` fixed one column that inherited
-- a table-wide grant issued before it existed, and the question it left behind was how many
-- others there are. Twenty-four columns across nine tables inherited one. Twenty-three are
-- harmless — a business's own data, on tables whose insert policy already asks for the right
-- capability. This is the one that is not.
--
-- **The hole.** `app.check_work_item_update_capability` is what holds `work_item.transition`,
-- `work_item.schedule` and `work_item.update` apart, and it is a **`before update`** trigger --
-- deliberately, because a policy sees the old row or the new one and never both. At *insert*
-- there is no old row, so the only thing between a caller and a scheduled job is
-- `work_items_insert`, which asks for `work_item.create` alone. `scheduled_during` has been in
-- the table-wide insert grant since `20260827000003`, so a member who may raise jobs and may not
-- put them in the diary could raise one already in it -- occupying a resource for a window
-- nobody let them book, and doing it in one statement that no trigger inspected.
--
-- **What was actually holding the line was the shape of the one caller.** `createWorkItem` takes
-- no schedule, so nothing in this repository ever wrote that column at insert. I12 is explicit
-- that this is not enough: *hiding UI is not authorization*, and a direct call must be refused
-- exactly as a form is. `work-item-editing.test.ts` now performs the raw insert.
--
-- **Why a grant rather than another trigger.** Extending the capability trigger to `insert` was
-- the obvious move and it breaks booking: `create_booking` inserts a scheduled job for a
-- stranger who holds no membership and therefore no capability, so the trigger would refuse the
-- one caller that is supposed to do this. A grant does not have that problem, because
-- `create_booking` is `security definer` owned by the table's owner and an owner's privileges
-- are not what a column grant restricts. **The narrowing is the privilege, not the policy** --
-- D28's shape, on a third axis: a permissive policy added here later still hits a missing
-- privilege.
--
-- **And two mirrors stop being grantable.** `occupies` and `status_releases_resource` are
-- derived by `before insert` triggers, so a caller's value was already being overwritten and
-- nothing was exploitable. What was wrong was the documentation: `CLAUDE.md` says of
-- `status_releases_resource` that "it is in no column grant", and
-- `work-item-editing.test.ts` said it is "outside every column grant" -- both true of update and
-- false of insert, for the same inherited-grant reason. Now they are true of both.

revoke insert on public.work_items from authenticated;

-- Everything a caller legitimately states about a job it is raising. Not `scheduled_during`,
-- which is the diary and belongs to `work_item.schedule`; not `occupies` or
-- `status_releases_resource`, which are the platform's answers to its own constraints and are
-- derived from the two columns above them.
--
-- `resource_id` stays, and the distinction is worth keeping: a resource with no window is an
-- assignment, and the exclusion constraint keys on `occupies` -- which is derived from
-- `scheduled_during` -- so a job naming a van and no time blocks nothing and double-books
-- nobody. `create_work_item` has taken a resource since `20260827000003` and is **not**
-- `security definer`, so removing it here would break the ordinary path rather than close
-- anything.
grant insert (
  id,
  organization_id,
  type_id,
  status_id,
  title,
  customer_id,
  location_id,
  resource_id,
  asset_id,
  custom,
  created_at,
  created_by
) on public.work_items to authenticated;

comment on column public.work_items.scheduled_during is
  'The window this job occupies a resource for. In no insert grant and in no update grant: scheduling is app.check_work_item_update_capability''s to authorize on update, and create_booking''s to write on insert as the table''s owner. A job is created, then put in the diary.';
