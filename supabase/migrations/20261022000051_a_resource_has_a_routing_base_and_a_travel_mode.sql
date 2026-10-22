-- What scheduling needs to know about a resource's *movement*, and no more.
--
-- Travel feasibility asks whether a resource can get from its previous commitment to a candidate and
-- on to its next. Two facts about the resource itself are missing for that, and both are the
-- business's to state, so both are nullable and neither has a default (a column saying "mobile" for
-- every resource would be the platform answering for the business):
--
--   travel_mode      mobile | fixed | null
--       mobile  the resource goes to the work, so travel between jobs is its constraint.
--       fixed   the resource stays where `base_location_id` is: a bay, a room. It can take work
--               only at that Location, and no route is ever asked of it.
--       null    not said. Travel is not evaluated for this resource at all — which is the answer
--               every resource had before this column existed, so nothing already scheduled or
--               booked changes meaning.
--
--   base_location_id  where the resource starts a working period when it has no earlier job in it,
--                     or where a fixed resource lives. A routing fallback: not a live position, not
--                     a home address, not a dispatch state. Optional.
--
-- Not a Resource Class default: a Vehicle is mobile, a Facility usually is not, Equipment is either,
-- and a person may be a desk worker. The class says what a resource *is*; this says how it *moves*.
--
-- The base Location is the same canonical `locations` row Work already points at — no second place,
-- no second coordinate. The composite key makes "Org A's resource at Org B's place" unrepresentable
-- (I2/I18), exactly as `work_items.location_id` does.

alter table public.resources
  add column travel_mode      text,
  add column base_location_id uuid;

alter table public.resources
  add constraint resources_travel_mode_known
  check (travel_mode is null or travel_mode in ('mobile', 'fixed'));

-- on delete set null (column) because a place that is gone is a base that is unknown, not a reason to
-- lose the resource. Only the Location column is nulled; the organization stays.
alter table public.resources
  add constraint resources_base_location_same_org
  foreign key (organization_id, base_location_id)
  references public.locations (organization_id, id) on delete set null (base_location_id);

comment on column public.resources.travel_mode is
  'mobile | fixed | null. null = travel is not evaluated for this resource. Stated by the business, never inferred from resource_class.';
comment on column public.resources.base_location_id is
  'A routing fallback: where this resource starts a working period with no earlier job in it, or where a fixed resource is. Not a live position.';

-- Insert is table-wide and held through `resources_insert` (resource.create), so both columns are
-- inherited there on purpose, as `resource_class` is. Update is by column, and the change goes
-- through the one narrow door below.
grant update (travel_mode, base_location_id) on public.resources to authenticated;

-- `resources_update` (resource.update), the column grant and the composite key decide.
create function public.set_resource_routing(
  p_resource_id      uuid,
  p_travel_mode      text,
  p_base_location_id uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'set_resource_routing requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.resources
     set travel_mode = p_travel_mode,
         base_location_id = p_base_location_id
   where id = p_resource_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such resource, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.routing_changed',
     jsonb_build_object('travel_mode', p_travel_mode, 'base_location_id', p_base_location_id));
end;
$fn$;

revoke all on function public.set_resource_routing(uuid, text, uuid) from public;
grant execute on function public.set_resource_routing(uuid, text, uuid) to authenticated;
