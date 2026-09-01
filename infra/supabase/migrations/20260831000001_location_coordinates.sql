-- Where a place actually is, as two numbers.
--
-- `20260827000001_locations.sql` shipped one `address` text column and said why: address shape
-- is per-country, getting it wrong in the schema is expensive, and "structured geocoding
-- arrives with the scheduling that needs it". The scheduling arrived without needing it. What
-- needs it is M6: nothing can ask a provider what conditions are at a place until the place is
-- expressible as a point, and `roadmap.md` names this as the one part of the weather work that
-- is not configuration. The same gap blocks travel time and service areas, which is why this is
-- a slice of its own rather than a detail of the weather one.
--
-- **Two columns and no `geography` type.** PostGIS answers questions this platform does not ask
-- yet -- distance, containment, nearest -- and an extension is a deployment dependency for
-- every tenant of every deployment. A point is two numbers until something needs to measure
-- between two of them, and the migration that needs that is the one that should pay for the
-- extension.
--
-- **The address stays the truth and this is derived from it.** A business types an address; a
-- provider, or a person, works out the point. Nothing here replaces the address, and a location
-- with no coordinates is an ordinary location -- exactly as a business with no operating hours
-- is an ordinary business. There is no default, no centroid of a country, and no guess.

alter table public.locations
  add column latitude  double precision,
  add column longitude double precision;

-- Both or neither, in the shape `work_item_types_bookable_is_complete` already uses. Half a
-- point is not a place, and a check that tested each column separately would pass on one --
-- `latitude between -90 and 90` is NULL rather than false when longitude is missing, and a
-- check constraint accepts NULL.
alter table public.locations
  add constraint locations_coordinates_are_complete
  check (
    (latitude is null and longitude is null)
    or (
      latitude is not null
      and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  );

comment on column public.locations.latitude is
  'Derived from the address, by a provider or by hand. Null is an ordinary answer: this business has not said where the place is.';

-- ---------------------------------------------------------------------------
-- The first write path this table has had since it was created
-- ---------------------------------------------------------------------------

-- `20260827000001` shipped insert and select and said "no update or delete policy: neither has
-- a caller in this change". The caller has arrived, and it is narrow enough to keep the rest of
-- the deferral intact -- a label, an address and access notes are still write-once here.
--
-- `location.create` rather than a new capability. Saying where a place is and adding one are
-- the same act by the same person, and a capability with no operation distinct from another is
-- vocabulary nobody can act on differently -- the reason `work_item_types_insert` reuses
-- `field.manage`.
create policy locations_update on public.locations
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'location.create')
  )
  with check (organization_id in (select app.current_tenant_ids()));

-- **A column grant, not a table grant**, which is what actually holds the deferral above. A
-- policy decides which rows; this decides which columns, and it refuses `label`, `address`,
-- `access_notes`, `custom` and `organization_id` to every caller through every path. An edit
-- path for those needs its own slice and its own argument -- in particular, moving a location
-- to a different address silently relocates every job ever done there.
grant update (latitude, longitude) on public.locations to authenticated;
